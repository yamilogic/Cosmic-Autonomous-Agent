# Chat with project plan

Phases:
1. Backend IPC dashboard:project-chat + context assembly + streaming + history storage + sources validation.
2. Chat UI in AgentChatPanel.
3. Model selection reuse resolveSettings.
4. Tests.

Files: src/main/dashboard/project-chat-service.ts, src/main/ipc, src/shared/dashboard-contract.ts, src/renderer AgentChatPanel.tsx, storage <userData>/dashboard/chat/<projectId>.json.

IPC channels: dashboard:project-chat (start), chat:chunk/done/error events, dashboard:clear-project-chat.

Retrieval interface retrieve(projectId, query) -> chunks, swappable for embeddings.

Context: insight + last 30 messages + BM25 top chunks, max 12.

History: per-project JSON, max 200, atomic write.

No write tools. Empty ProjectTool registry.

Approval needed before implementation.
