import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true); setError("");
    try {
      await apiRequest("POST", "/api/admin/forgot-password", { email });
      setSent(true);
    } catch (err: any) {
      setError(err.message || "無法傳送請求，請稍後再試。");
    } finally { setLoading(false); }
  };
  return (
    <main className="min-h-[100dvh] bg-muted/40 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
            {sent ? <CheckCircle2 className="h-7 w-7" /> : <Mail className="h-7 w-7" />}
          </div>
          <CardTitle>{sent ? "請查看您的電子郵件" : "重設密碼"}</CardTitle>
          <CardDescription>{sent ? "若此電子郵件有對應帳號，我們已寄出重設密碼說明。" : "輸入您的帳號電子郵件，我們會寄送安全的重設連結。"}</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? <Button className="w-full" onClick={() => setLocation("/admin")}>返回登入</Button> : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="forgot-email">電子郵件</Label>
                <Input id="forgot-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" type="submit" disabled={loading} data-testid="button-forgot-password">
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}傳送重設連結
              </Button>
              <Button className="w-full" type="button" variant="ghost" onClick={() => setLocation("/admin")}><ArrowLeft className="mr-2 h-4 w-4" />返回登入</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}