import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import {
	ExecutionBaseError,
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
} from 'n8n-workflow';
import {
	allConversations,
	answerOf,
	API,
	ChatFromError,
	fromChatFrom,
	InputError,
	itemsFrom,
	listOfPages,
	MAY_STILL_FINISH,
	ORIGIN,
	OUTSIDERS,
	requestFor,
	simplified,
	withOneRetry,
	type ApiRequest,
	type Fields,
} from './client';
import { properties } from './fields';

// Each operation is one request to ChatFrom's REST API (client.ts). The node is
// written out rather than declarative: an answer comes as a stream that is read
// whole, Add Pages reads page addresses out of free text and answers the
// entries it cannot send in their places, and a refusal that names its wait is
// asked once more.

/** Adding, indexing and answering (ApiRequest.slow) can take ChatFrom up to two minutes; the rest answer in seconds. */
const SLOW_MS = 130_000;
const CALL_MS = 30_000;

/** How far back the conversation picker looks, and how many of the newest of those days it lists. */
const PICKER_DAYS = 30;
const PICKER_SHOWN = 50;

/** The operations whose output holds text others wrote: visitors' messages, answers, page titles, document names. */
const OUTSIDERS_IN = new Set([
	'chatbot.ask',
	'conversation.get',
	'conversation.getAll',
	'knowledge.addPages',
	'knowledge.getAll',
]);

/** n8n's codes for a request cut off before ChatFrom answered: it stopped waiting, or the connection broke. */
const CUT_OFF = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET']);

/** What one request gave back: the API's answer, and for a chat, the conversation it went into. */
interface Answered {
	answer: unknown;
	conversationId?: unknown;
}

async function callOnce(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	request: ApiRequest,
): Promise<Answered> {
	const slow = request.slow === true;
	// A chat's answer streams: it is asked for as text and read whole (client.ts).
	const streams = request.path === '/chat';
	const options: IHttpRequestOptions = {
		method: request.method,
		url: `${API}${request.path}`,
		...(request.qs ? { qs: request.qs } : {}),
		...(request.body === undefined
			? {}
			: streams
				? { body: JSON.stringify(request.body), headers: { 'content-type': 'application/json' } }
				: { body: request.body }),
		json: !streams,
		...(streams ? { encoding: 'text' as const } : {}),
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		// The API never redirects: one that did would be followed with the key, to wherever it pointed.
		disableFollowRedirect: true,
		sendCredentialsOnCrossOriginRedirect: false,
		timeout: slow ? SLOW_MS : CALL_MS,
	};
	const sent = await this.helpers.httpRequestWithAuthentication
		.call(this, 'chatFromApi', options)
		.then(
			(res) => ({
				res: res as { statusCode: number; body: unknown; headers?: Record<string, unknown> },
			}),
			(error: unknown) => ({ error }),
		);
	// A slow call adds or answers, and may have done so though no answer came back: cut off, or a gateway's error
	// while a deploy replaced the app. Said as such, so the work is checked rather than asked for again. A new
	// error, not n8n's own, which NodeApiError would hand back unchanged, and with no code, for which n8n would put
	// back its own "perhaps the server is offline".
	const mayStillFinish = (httpCode?: string) =>
		new NodeApiError(this.getNode(), { message: MAY_STILL_FINISH } as JsonObject, {
			message: MAY_STILL_FINISH,
			httpCode,
		});
	if ('error' in sent) {
		const code = (sent.error as { httpCode?: unknown } | null)?.httpCode;
		if (slow && typeof code === 'string' && CUT_OFF.has(code)) throw mayStillFinish();
		throw sent.error;
	}
	const { statusCode, body, headers } = sent.res;
	// The app's own 502 says what failed in its words; a gateway's, while a deploy replaces the app, says nothing of it.
	if (slow && (statusCode === 502 || statusCode === 504) && !fromChatFrom(body))
		throw mayStillFinish(String(statusCode));
	return {
		answer: answerOf(statusCode, body, headers?.['retry-after']),
		conversationId: headers?.['x-conversation-id'],
	};
}

/** A request, made once more after the wait ChatFrom names when it refused before doing anything (client.ts). */
async function callApi(this: IExecuteFunctions, request: ApiRequest): Promise<Answered> {
	// The wait ends when the run is stopped (an n8n too old to say so just waits), and then nothing more is sent.
	const signal = this.getExecutionCancelSignal?.();
	const pause = async (ms: number) => {
		await sleep(ms, signal);
		if (signal?.aborted)
			throw new NodeOperationError(
				this.getNode(),
				'The run was stopped before ChatFrom was asked again.',
			);
	};
	return await withOneRetry(() => callOnce.call(this, request), pause);
}

/**
 * A failure as n8n shows it: fields to fix, ChatFrom's own words when it gave
 * a reason, n8n's own error (a parameter, an expression, no connection) as it
 * is, else the request's error.
 */
function failure(node: INode, error: unknown, itemIndex?: number) {
	if (error instanceof InputError)
		return new NodeOperationError(node, error.message, { itemIndex });
	if (error instanceof ChatFromError) {
		return new NodeApiError(node, { message: error.message } as JsonObject, {
			itemIndex,
			message: error.message,
			httpCode: error.status === undefined ? undefined : String(error.status),
		});
	}
	if (error instanceof ExecutionBaseError) {
		if (error.context.itemIndex === undefined) error.context.itemIndex = itemIndex;
		return error;
	}
	return new NodeApiError(node, error as JsonObject, { itemIndex });
}

/** A field's value as text, whatever an expression gave: a list, such as of page addresses, one entry a line. */
const asText = (v: unknown): string => {
	if (Array.isArray(v)) return v.map(asText).join('\n');
	if (v === undefined || v === null) return '';
	return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

/** Whether a switch is on, from a switch or an expression's `true`. */
const on = (v: unknown) => v === true || v === 'true';

/** The fields an operation reads, for one item. */
function fieldsOf(ctx: IExecuteFunctions, resource: string, operation: string, i: number): Fields {
	const raw = (name: string) => asText(ctx.getNodeParameter(name, i, ''));
	const located = (name: string) =>
		asText(ctx.getNodeParameter(name, i, '', { extractValue: true })).trim();
	const usesChatbot =
		resource === 'knowledge' ||
		resource === 'conversation' ||
		(resource === 'chatbot' && operation !== 'getAll');
	const f: Fields = {};
	if (usesChatbot) f.chatbotId = located('chatbot');
	switch (`${resource}.${operation}`) {
		case 'chatbot.ask': {
			const options = ctx.getNodeParameter('options', i, {}) as IDataObject;
			f.message = raw('message');
			f.conversationId = asText(options.conversationId).trim();
			f.threadId = asText(options.threadId).trim();
			break;
		}
		case 'knowledge.addPages': {
			const urls = ctx.getNodeParameter('urls', i, '');
			f.urls = Array.isArray(urls) ? listOfPages(urls) : asText(urls).trim();
			break;
		}
		case 'knowledge.addText':
			f.title = raw('title').trim();
			f.content = raw('content');
			break;
		case 'knowledge.addQa':
			f.question = raw('question').trim();
			f.answer = raw('answer');
			break;
		case 'knowledge.remove':
			f.documentId = located('documentId');
			break;
		case 'conversation.get':
			f.conversationId = located('conversationId');
			break;
		case 'conversation.getAll': {
			const filters = ctx.getNodeParameter('filters', i, {}) as IDataObject;
			if (filters.days !== undefined && filters.days !== null && filters.days !== '') {
				const days = Number(filters.days);
				if (!Number.isFinite(days) || days < 1)
					throw new NodeOperationError(ctx.getNode(), "The 'Days' filter must be a number of days, 1 or more.", {
						itemIndex: i,
					});
				f.days = days;
			}
			f.unanswered = on(filters.unanswered);
			f.ratedDown = on(filters.ratedDown);
			f.handedOff = on(filters.handedOff);
			break;
		}
	}
	return f;
}

/**
 * A Get Many's Limit, checked: an expression can give 0, 2.5 or a word, which no list has, and the route would refuse
 * it in its own terms. A whole number written as text, as an expression often gives one, is read as that number.
 */
function limitOf(ctx: IExecuteFunctions, i: number): number {
	const given = ctx.getNodeParameter('limit', i, 50) as unknown;
	const limit = typeof given === 'string' && given.trim() !== '' ? Number(given) : given;
	if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)
		throw new NodeOperationError(ctx.getNode(), "The 'Limit' must be a whole number, 1 or more.", {
			itemIndex: i,
		});
	return limit;
}

/**
 * What one item's call gives back, as items: a chatbot simplified, a list cut
 * to its Limit, and, for an AI agent's tool, text others wrote marked as data.
 */
function itemsOf(
	ctx: IExecuteFunctions,
	op: string,
	i: number,
	request: ApiRequest,
	answered: Answered,
): IDataObject[] {
	let items = itemsFrom(op, request, answered.answer, answered.conversationId) as IDataObject[];
	if (op === 'chatbot.get' && ctx.getNodeParameter('simplify', i, true))
		items = items.map((c) => simplified(c) as IDataObject);
	if (op.endsWith('.getAll') && !ctx.getNodeParameter('returnAll', i, false)) items = items.slice(0, limitOf(ctx, i));
	// Once, first, on the first item: the agent reads it before the text, and a list of fifty does not carry it fifty times.
	if (ctx.getNode().type.endsWith('Tool') && OUTSIDERS_IN.has(op) && items.length)
		items[0] = { note: OUTSIDERS, ...items[0] };
	return items;
}

/** A list for a picker in the editor, read as the node reads it. */
async function listed(
	ctx: ILoadOptionsFunctions,
	op: string,
	fields: Fields,
	qs: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
	const [resource, operation] = op.split('.');
	try {
		const made = requestFor(resource, operation, fields);
		const request = { ...made, qs: { ...made.qs, ...qs } };
		const answered = await callOnce.call(ctx, request);
		return itemsFrom(op, request, answered.answer, answered.conversationId);
	} catch (error) {
		throw failure(ctx.getNode(), error);
	}
}

/** A picker's entries that hold the words typed in its search box. */
const matching = (entries: { name: string; value: string; url?: string }[], filter?: string) => {
	const words = filter?.trim().toLowerCase();
	return { results: entries.filter((e) => !words || e.name.toLowerCase().includes(words)) };
};

/** The chatbot chosen above, for a picker that lists one chatbot's sources or conversations. */
const chosenChatbot = (ctx: ILoadOptionsFunctions) =>
	asText(ctx.getCurrentNodeParameter('chatbot', { extractValue: true })).trim();

export class ChatFrom implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ChatFrom',
		name: 'chatFrom',
		icon: { light: 'file:chatfrom.svg', dark: 'file:chatfrom.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Ask your ChatFrom chatbots, add to their knowledge and read their conversations',
		defaults: { name: 'ChatFrom' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'chatFromApi', required: true }],
		properties,
	};

	methods = {
		listSearch: {
			async searchChatbots(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const list = await listed(this, 'chatbot.getAll', {});
				return matching(
					list.map((c) => {
						const name = asText(c.name) || 'Untitled';
						return {
							name: c.status === 'live' ? name : `${name} (draft)`,
							value: asText(c.id),
							url: `${ORIGIN}/dashboard/${encodeURIComponent(asText(c.id))}`,
						};
					}),
					filter,
				);
			},

			async searchSources(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const chatbotId = chosenChatbot(this);
				if (!chatbotId) return { results: [] };
				const list = await listed(this, 'knowledge.getAll', { chatbotId });
				return matching(
					list.map((d) => ({ name: asText(d.name) || asText(d.doc_id), value: asText(d.doc_id) })),
					filter,
				);
			},

			async searchConversations(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const chatbotId = chosenChatbot(this);
				if (!chatbotId) return { results: [] };
				const list = await listed(this, 'conversation.getAll', { chatbotId, days: PICKER_DAYS }, { limit: String(PICKER_SHOWN) });
				return matching(
					list.map((c) => {
						// The channel and the day, of those it has, to tell apart conversations that began alike.
						const about = [asText(c.channel), asText(c.last_message_at ?? c.updated_at).slice(0, 10)]
							.filter(Boolean)
							.join(', ');
						const title = asText(c.title) || 'Untitled';
						return { name: about ? `${title} (${about})` : title, value: asText(c.id) };
					}),
					filter,
				);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		// Each item is a call of its own. Once ChatFrom has refused the key, the rest are not sent: they would be
		// refused too, and wrong keys are counted against this n8n's address, which other accounts may share.
		let keyRefused: string | undefined;
		const signal = this.getExecutionCancelSignal?.();
		for (let i = 0; i < items.length; i++) {
			// A stopped run sends nothing more, Continue On Fail or not.
			if (signal?.aborted)
				throw new NodeOperationError(this.getNode(), 'The run was stopped before this item was sent.', {
					itemIndex: i,
				});
			if (keyRefused !== undefined) {
				out.push({ json: { error: keyRefused }, pairedItem: { item: i } });
				continue;
			}
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const request = requestFor(resource, operation, fieldsOf(this, resource, operation, i));
				const op = `${resource}.${operation}`;
				const all = op.endsWith('.getAll') && (this.getNodeParameter('returnAll', i, false) as boolean);
				const limit = op.endsWith('.getAll') && !all ? limitOf(this, i) : Infinity;
				// Conversations come page by page, as many as Return All or the Limit asks for; a stopped run asks for no more.
				const answered: Answered =
					op === 'conversation.getAll'
						? {
								answer: await allConversations(
									request,
									async (page) => (await callApi.call(this, page)).answer,
									limit,
									() => {
										if (signal?.aborted)
											throw new NodeOperationError(
												this.getNode(),
												'The run was stopped before ChatFrom was asked for the next conversations.',
												{ itemIndex: i },
											);
									},
								),
							}
						: await callApi.call(this, request);
				const data = itemsOf(this, op, i, request, answered);
				out.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(data), {
						itemData: { item: i },
					}),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					const message = failure(this.getNode(), error, i).message;
					if (error instanceof ChatFromError && error.status === 401) keyRefused = message;
					out.push({ json: { error: message }, pairedItem: { item: i } });
					continue;
				}
				throw failure(this.getNode(), error, i);
			}
		}
		return [out];
	}
}
