# Changelog

## 0.2.1

- Conversation, Get Many has **Return All**, and its **Limit** has no ceiling: the node reads the conversations from ChatFrom 500 at a time, each page after the last conversation of the one before, until it has them all or as many as the Limit says. Before, it gave the newest 50 at most.
- A conversation in Get Many's list has `last_message_at`, the moment the list is ordered by. `updated_at` also moves when a conversation is rated or handed to a person.
- A 'Limit' that is not a whole number of 1 or more, as an expression can give, stops the item with a message that says so. Stopping the run stops the reading between pages too.
- Action names without articles, as n8n's UX guidelines ask ("Ask chatbot", "Get conversation"), and a parameter named in a description or a message in single quotes ('Days', 'Simplify'). The operations themselves are unchanged, so saved workflows keep working.

## 0.2.0

- Calls ChatFrom's REST API, the routes the dashboard itself calls, rather than its MCP server. The operations, their fields and what they give back are the same as in 0.1.0.
- The credential is checked by reading the account's usage, which costs no credits.

## 0.1.0

- The ChatFrom node: ask a chatbot, get one or many, add pages, texts and Q&As to its knowledge, list and remove its sources, read its conversations and the account's usage.
- The ChatFrom API credential, with an API key from ChatFrom.
