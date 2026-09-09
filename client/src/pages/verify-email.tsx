import { useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, MailCheck, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { apiRequest } from "@/lib/queryClient";
import { SellCaseLogo } from "@/components/sellcase-logo";

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const [email, setEmail] = useState(params.get("email") || "");
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [resending, setResending] = useState(false);

  const verify = async () => {
    if (!email || code.length !== 6) return;
    setState("submitting");
    setMessage("");
    try {
      await apiRequest("POST", "/api/admin/verify-email", { email, code });
      setState("success");
    } catch (error: any) {
      setState("error");
      setMessage(error.message || "驗證碼錯誤或已過期");
    }
  };

  const resend = async () => {
    if (!email) return;
    setResending(true);
    setMessage("");
    try {
      await apiRequest("POST", "/api/admin/resend-verification", { email });
      setCode("");
      setState("idle");
      setMessage("新的驗證碼已寄出，請查看收件匣。");
    } catch (error: any) {
      setMessage(error.message || "暫時無法重新寄送驗證碼");
    } finally {
      setResending(false);
    }
  };

  const success = state === "success";
  return (
    <main className="min-h-[100dvh] bg-muted/40 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <SellCaseLogo className="mx-auto mb-5 h-auto w-[180px]" />
          <div className={`mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full ${success ? "bg-emerald-100 text-emerald-600" : "bg-primary/10 text-primary"}`}>
            {state === "submitting" ? <Loader2 className="h-7 w-7 animate-spin" /> : success ? <CheckCircle2 className="h-7 w-7" /> : <MailCheck className="h-7 w-7" />}
          </div>
          <CardTitle>{success ? "電子郵件已驗證" : "輸入電子郵件驗證碼"}</CardTitle>
          <CardDescription>
            {success ? "您的帳號現在可以登入並開始管理研討會。" : "請輸入寄到您信箱的六位數驗證碼。驗證碼將在 10 分鐘後失效。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!success ? (
            <>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="帳號電子郵件"
                autoComplete="email"
                data-testid="input-verification-email"
              />
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(value) => {
                  setCode(value.replace(/\D/g, ""));
                  if (state === "error") setState("idle");
                }}
                inputMode="numeric"
                containerClassName="justify-center"
                data-testid="input-verification-code"
              >
                <InputOTPGroup>
                  {Array.from({ length: 6 }, (_, index) => (
                    <InputOTPSlot key={index} index={index} className="h-12 w-12 text-lg" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {message && <p className={`text-center text-sm ${state === "error" ? "text-destructive" : "text-muted-foreground"}`}>{message}</p>}
              <Button className="w-full" disabled={!email || code.length !== 6 || state === "submitting"} onClick={verify} data-testid="button-verify-email">
                {state === "submitting" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                驗證電子郵件
              </Button>
              <Button variant="ghost" className="w-full" disabled={!email || resending} onClick={resend} data-testid="button-resend-verification">
                {resending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                重新寄送驗證碼
              </Button>
            </>
          ) : (
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