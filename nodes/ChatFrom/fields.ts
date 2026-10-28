import type { INodeProperties } from 'n8n-workflow';
import { CONVERSATIONS_MAX, PAGES_MAX } from './client';

// The node's parameters: a resource, its operation, then the fields that
// operation reads. Each operation is one tool of ChatFrom's agent endpoint
// (client.ts, toolFor).

/** The chatbot an operation works on, picked from the account's list or given by its ID. */
const chatbot = (show: Record<string, string[]>): INodeProperties => ({
	displayName: 'Chatbot',
	name: 'chatbot',
	type: 'resourceLocator',
	required: true,
	default: { mode: 'list', value: '' },
	description: 'The chatbot to use',
	displayOptions: { show },
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchChatbots', searchable: true },
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 6f1c2d0e-7a5b-4c3d-9e8f-0a1b2c3d4e5f',
		},
	],
});

/** One of a chatbot's sources or conversations, picked from the chatbot's list or given by its ID. */
const ofChatbot = (o: {
	displayName: string;
	name: string;
	description: string;
	searchListMethod: string;
	show: Record<string, string[]>;
}): INodeProperties => ({
	displayName: o.displayName,
	name: o.name,
	type: 'resourceLocator',
	required: true,
	default: { mode: 'list', value: '' },
	description: o.description,
	displayOptions: { show: o.show },
	typeOptions: { loadOptionsDependsOn: ['chatbot.value'] },
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: o.searchListMethod, searchable: true },
		},
		{ displayName: 'ID', name: 'id', type: 'string' },
	],
});

/** Return All and Limit, for an operation that lists. */
const listing = (resource: string): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: [resource], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: [resource], operation: ['getAll'], returnAll: [false] } },
	},
];

export const properties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Chatbot', value: 'chatbot' },
			{ name: 'Conversation', value: 'conversation' },
			{ name: 'Knowledge', value: 'knowledge' },
			{ name: 'Usage', value: 'usage' },
		],
		default: 'chatbot',
	},

	// Chatbot
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['chatbot'] } },
		options: [
			{
				name: 'Ask',
				value: 'ask',
				description: 'Ask a chatbot a question and get its answer with the sources it used',
				action: 'Ask a chatbot',
			},
			{
				name: 'Get',
				value: 'get',
				description:
					"Get a chatbot's name, status, model, embed snippet and share link; with Simplify off, its instructions and every setting too",
				action: 'Get a chatbot',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: "List the account's chatbots",
				action: 'Get many chatbots',
			},
		],
		default: 'ask',
	},
	chatbot({ resource: ['chatbot'], operation: ['ask', 'get'] }),
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: { show: { resource: ['chatbot'], operation: ['get'] } },
	},
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 2 },
		required: true,
		default: '',
		description:
			"What to ask, as a visitor would. The answer uses the account's monthly credits, as any answer does.",
		displayOptions: { show: { resource: ['chatbot'], operation: ['ask'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['chatbot'], operation: ['ask'] } },
		options: [
			{
				displayName: 'Conversation ID',
				name: 'conversationId',
				type: 'string',
				default: '',
				description:
					'The conversation_id an earlier answer gave, to ask a follow-up in the same conversation',
			},
			{
				displayName: 'Thread ID',
				name: 'threadId',
				type: 'string',
				default: '',
				description:
					"When the last answer asked a question of its own (a step of the chatbot's workflow waiting for input), its thread_id. The message is then the reply to it. Send the same Conversation ID too.",
			},
		],
	},
	...listing('chatbot'),

	// Knowledge
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['knowledge'] } },
		options: [
			{
				name: 'Add Pages',
				value: 'addPages',
				description: "Add web pages to a chatbot's knowledge. ChatFrom reads each page itself.",
				action: 'Add pages to a chatbot',
			},
			{
				name: 'Add Q&A',
				value: 'addQa',
				description: 'Add a question with the exact answer the chatbot should give to it',
				action: 'Add a question and answer to a chatbot',
			},
			{
				name: 'Add Text',
				value: 'addText',
				description: "Add a text to a chatbot's knowledge, such as opening hours or a policy",
				action: 'Add a text to a chatbot',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: "List a chatbot's knowledge sources",
				action: 'Get many knowledge sources',
			},
			{
				name: 'Remove',
				value: 'remove',
				description: "Remove one source from a chatbot's knowledge",
				action: 'Remove a knowledge source',
			},
		],
		default: 'addPages',
	},
	chatbot({ resource: ['knowledge'] }),
	{
		displayName: 'Page URLs',
		name: 'urls',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com/shipping',
		description: `One page's address, or several on their own lines or separated by a comma or semicolon and a space, up to ${PAGES_MAX}. An expression may also give a list of addresses. A page added before is replaced by its newer version, and one that has not changed costs nothing. A page behind a sign-in cannot be added, and an entry that is not a web address comes back as not added.`,
		displayOptions: { show: { resource: ['knowledge'], operation: ['addPages'] } },
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		description: 'Up to 120 characters. A text with the same title replaces the old one.',
		displayOptions: { show: { resource: ['knowledge'], operation: ['addText'] } },
	},
	{
		displayName: 'Content',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 6 },
		required: true,
		default: '',
		description: 'The text, in plain words or Markdown',
		displayOptions: { show: { resource: ['knowledge'], operation: ['addText'] } },
	},
	{
		displayName: 'Question',
		name: 'question',
		type: 'string',
		required: true,
		default: '',
		description: 'Up to 300 characters. The same question again replaces its answer.',
		displayOptions: { show: { resource: ['knowledge'], operation: ['addQa'] } },
	},
	{
		displayName: 'Answer',
		name: 'answer',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'The answer the chatbot gives to this question',
		displayOptions: { show: { resource: ['knowledge'], operation: ['addQa'] } },
	},
	ofChatbot({
		displayName: 'Source',
		name: 'documentId',
		description:
			'The source to remove. Its ID is the doc_id that Get Many, Add Pages, Add Text or Add Q&A gives.',
		searchListMethod: 'searchSources',
		show: { resource: ['knowledge'], operation: ['remove'] },
	}),
	...listing('knowledge'),

	// Conversation
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['conversation'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get one conversation, message by message, with the sources each answer used',
				action: 'Get a conversation',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: `List a chatbot's conversations from every channel, newest first: up to ${CONVERSATIONS_MAX}, from the last 7 days unless Days says otherwise`,
				action: 'Get many conversations',
			},
		],
		default: 'getAll',
	},
	chatbot({ resource: ['conversation'] }),
	ofChatbot({
		displayName: 'Conversation',
		name: 'conversationId',
		description:
			'The conversation to get. The list shows the newest of the last 30 days; its ID is the one Get Many gives.',
		searchListMethod: 'searchConversations',
		show: { resource: ['conversation'], operation: ['get'] },
	}),
	// The tool gives back the newest 50 at most (the operation's description says so), so there is no Return All here.
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: CONVERSATIONS_MAX },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['conversation'], operation: ['getAll'] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['conversation'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Days',
				name: 'days',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 7,
				description: 'How many days back to look. Without this filter, the last 7 days.',
			},
			{
				displayName: 'Handed Off',
				name: 'handedOff',
				type: 'boolean',
				default: false,
				description: 'Whether to return only conversations passed to a person',
			},
			{
				displayName: 'Rated Down',
				name: 'ratedDown',
				type: 'boolean',
				default: false,
				description: 'Whether to return only conversations with an answer rated down',
			},
			{
				displayName: 'Unanswered',
				name: 'unanswered',
				type: 'boolean',
				default: false,
				description: 'Whether to return only conversations the chatbot could not answer',
			},
		],
	},

	// Usage
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['usage'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description:
					"Get the credits used this month against the plan's allowance, and when it starts again",
				action: 'Get the account usage',
			},
		],
		default: 'get',
	},
];
