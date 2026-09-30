import { AgentConversationSidebar } from "./AgentConversationSidebar";
import { useAgentChatNavigation, useOpenAgentChat } from "@/hooks/useAgentChatNavigation";
import { useLocation, useNavigate } from "@/lib/router";
import { useSidebar } from "@/context/SidebarContext";
import { agentRouteRef } from "@/lib/utils";

/** Account- and company-scoped data for the secondary chat navigation. */
export function AgentConversationsSidebar() {
  const { companyId, userId, agents, chats, session } = useAgentChatNavigation();
  const openChat = useOpenAgentChat(companyId, userId);
  const navigate = useNavigate();
  const { isMobile, setSidebarOpen } = useSidebar();
  const { pathname } = useLocation();
  const activeRef = pathname.split("/chats/")[1]?.split("/")[0];
  const roster = agents.data ?? [];
  const active = roster.find(agent => agent.id === activeRef || encodeURIComponent(agentRouteRef(agent)) === activeRef);
  const ids = new Set((chats.data ?? []).map(chat => chat.conversationAgentId));
  const conversations = roster.filter(agent => ids.has(agent.id) || agent.id === active?.id);
  const previews = Object.fromEntries((chats.data ?? []).filter(chat => chat.conversationState === "active")
    .map(chat => [chat.conversationAgentId!, "Working…"]));
  return <AgentConversationSidebar key={`${companyId}:${userId}`} agents={conversations} availableAgents={roster}
    activeId={active?.id} previews={previews}
    loading={agents.isPending || chats.isPending || session.isPending}
    error={agents.error ?? chats.error ?? session.error}
    onRetry={() => { void agents.refetch(); void chats.refetch(); void session.refetch(); }}
    onAddChat={openChat}
    onSelect={agent => {
      navigate(`/chats/${encodeURIComponent(agentRouteRef(agent))}`);
      if (isMobile) setSidebarOpen(false);
    }} />;
}
