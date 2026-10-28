import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { ENDPOINT } from '../nodes/ChatFrom/client';

export class ChatFromApi implements ICredentialType {
	name = 'chatFromApi';

	displayName = 'ChatFrom API';

	icon: Icon = {
		light: 'file:../nodes/ChatFrom/chatfrom.svg',
		dark: 'file:../nodes/ChatFrom/chatfrom.dark.svg',
	};

	// Only the ChatFrom node may use the key: an HTTP Request node, or an agent's HTTP Request tool, could send it to
	// any address it was given.
	restrictToSupportedNodes = true as const;

	documentationUrl = 'https://github.com/rouzbeh-abadi/n8n-nodes-chatfrom#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'cf_…',
			description:
				'A key from ChatFrom, under Account, API keys. Make one for n8n alone, so you can delete it on its own.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Listing the tools needs a right key and costs no credits.
	test: ICredentialTestRequest = {
		request: {
			url: ENDPOINT,
			method: 'POST',
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
			// As the node's own calls: a redirect would be followed with the key.
			disableFollowRedirect: true,
			sendCredentialsOnCrossOriginRedirect: false,
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'ChatFrom does not know this API key. Make one in ChatFrom under Account, API keys; it starts with cf_.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 429,
					message:
						'ChatFrom is refusing for a minute: too many requests with this key, or too many wrong keys from this n8n. Try again in a minute.',
				},
			},
		],
	};
}
