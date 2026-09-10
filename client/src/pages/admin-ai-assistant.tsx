import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, Database, MessageSquareWarning } from "lucide-react";
import { AiLogsPanel } from "@/components/ai-assistant/logs-panel";
import { AiSettingsPanel } from "@/components/ai-assistant/settings-panel";
import { AiSourcesPanel } from "@/components/ai-assistant/sources-panel";
import { AiTestQuestionPanel } from "@/components/ai-assistant/test-question-panel";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryClient } from "@/lib/queryClient";
import type { AiReplySettingsResponse } from "@shared/aiAssistant";

export default function AdminAiAssistant() {
  const { id = "" } = useParams<{ id: string }>();
  const [tab, setTab] = useState("settings");
  const settingsUrl = `/api/webinars/${id}/ai/settings`;
  const settings = useQuery<AiReplySettingsResponse>({ queryKey: [settingsUrl], enabled: !!id });
  const refreshKnowledge = () => queryClient.invalidateQueries({ queryKey: [`/api/webinars/${id}/documents`] });

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <a href={`/admin/webinar/${id}`} className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />返回說明會</a>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Bot className="h-5 w-5" /></span>
              <div className="min-w-0"><h1 className="truncate text-xl font-semibold">AI 品牌助理</h1><p className="truncate text-sm text-muted-foreground">{settings.data?.webinarTitle || (settings.isLoading ? "載入說明會資料…" : "說明會")}</p></div>
            </div>
          </div>
          {settings.data && <Badge variant={settings.data.settings.enabled ? "default" : "secondary"}>{settings.data.settings.enabled ? "已啟用" : "未啟用"}</Badge>}
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
        <div className="mb-6 max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight">用自己的內容，回答學員真正的問題</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">設定符合品牌的助理、整理教學與產品知識，並從實際回覆紀錄修正不理想的答案。</p>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6 grid h-auto w-full grid-cols-3 sm:w-auto">
            <TabsTrigger className="gap-2 py-2.5" value="settings"><Bot className="hidden h-4 w-4 sm:block" />人設與回覆</TabsTrigger>
            <TabsTrigger className="gap-2 py-2.5" value="sources"><Database className="hidden h-4 w-4 sm:block" />知識資料</TabsTrigger>
            <TabsTrigger className="gap-2 py-2.5" value="logs"><MessageSquareWarning className="hidden h-4 w-4 sm:block" />回覆紀錄</TabsTrigger>
          </TabsList>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
              <TabsContent value="settings" className="mt-0"><AiSettingsPanel webinarId={id} /></TabsContent>
              <TabsContent value="sources" className="mt-0"><AiSourcesPanel webinarId={id} /></TabsContent>
              <TabsContent value="logs" className="mt-0"><AiLogsPanel webinarId={id} onKnowledgeChanged={refreshKnowledge} /></TabsContent>
            </div>
            <AiTestQuestionPanel webinarId={id} />
          </div>
        </Tabs>
      </main>
    </div>
  );
}