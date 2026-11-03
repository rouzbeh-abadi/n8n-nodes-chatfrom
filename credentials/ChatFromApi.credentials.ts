import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { API } from '../nodes/ChatFrom/client';

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

	// Reading the month's usage needs a right key and costs no credits. Like any of the node's requests, it is
	// answered as the key's owner, so ChatFrom signs in as them first if it has not lately.
	test: ICredentialTestRequest = {
		request: {
			url: `${API}/account/usage`,
			method: 'GET',
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
					value: 403,
					message:
						'This ChatFrom account is blocked from signing in, so its API keys are too. Contact ChatFrom support.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 503,
					message: 'ChatFrom could not check this key just now. Try again in a minute.',
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
