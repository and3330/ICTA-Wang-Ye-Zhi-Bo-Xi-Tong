import { useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(token ? "" : "此重設連結無效或已過期。");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) return setError("密碼至少需要 8 個字元。");
    if (password !== confirm) return setError("兩次輸入的密碼不一致。");
    setLoading(true); setError("");
    try { await apiRequest("POST", "/api/admin/reset-password", { token, password }); setDone(true); }
    catch (err: any) { setError(err.message || "無法重設密碼，請重新申請連結。"); }
    finally { setLoading(false); }
  };
  return (
    <main className="min-h-[100dvh] bg-muted/40 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">{done ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <KeyRound className="h-7 w-7" />}</div>
          <CardTitle>{done ? "密碼已更新" : "建立新密碼"}</CardTitle>
          <CardDescription>{done ? "您現在可以使用新密碼登入。" : "請設定至少 8 個字元的新密碼。"}</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? <Button className="w-full" onClick={() => setLocation("/admin")}>前往登入</Button> : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2"><Label htmlFor="reset-password">新密碼</Label><Input id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="reset-confirm">確認新密碼</Label><Input id="reset-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" type="submit" disabled={loading || !token} data-testid="button-reset-password">{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}更新密碼</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}