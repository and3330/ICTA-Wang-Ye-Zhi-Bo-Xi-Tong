import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, MailWarning, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("error");
      return;
    }
    apiRequest("POST", "/api/admin/verify-email", { token })
      .then(() => setState("success"))
      .catch(() => setState("error"));
  }, []);

  const success = state === "success";
  return (
    <main className="min-h-[100dvh] bg-muted/40 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className={`mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full ${success ? "bg-emerald-100 text-emerald-600" : "bg-primary/10 text-primary"}`}>
            {state === "loading" ? <Loader2 className="h-7 w-7 animate-spin" /> : success ? <CheckCircle2 className="h-7 w-7" /> : <MailWarning className="h-7 w-7" />}
          </div>
          <CardTitle>{state === "loading" ? "正在驗證電子郵件…" : success ? "電子郵件已驗證" : "驗證連結無效或已過期"}</CardTitle>
          <CardDescription>
            {state === "loading" ? "請稍候，我們正在安全地確認您的帳號。" : success ? "您的帳號現在可以登入並開始管理研討會。" : "驗證連結僅能使用一次，且會在 30 分鐘後失效。請從登入頁重新寄送驗證信。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state !== "loading" && (
            <Button className="w-full" onClick={() => setLocation("/admin")} data-testid="button-verify-go-login">
              <ShieldCheck className="mr-2 h-4 w-4" />
              前往登入
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}