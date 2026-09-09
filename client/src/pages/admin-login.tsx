import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Languages, MailCheck } from "lucide-react";
import { useLang, type LangFull } from "@/hooks/use-lang";
import { SellCaseLogo } from "@/components/sellcase-logo";

const langLabels: Record<LangFull, string> = {
  "zh-TW": "繁體中文",
  "zh-CN": "简体中文",
  "en": "English",
};

const langShort: Record<LangFull, string> = {
  "zh-TW": "繁",
  "zh-CN": "简",
  "en": "EN",
};

const t: Record<LangFull, Record<string, string>> = {
  "zh-TW": {
    subtitle: "自動化研討會平台",
    signInTitle: "登入",
    signInDesc: "登入管理您的研討會",
    createTitle: "建立帳號",
    createDesc: "立即開始自動化您的研討會",
    username: "使用者名稱",
    usernamePh: "輸入使用者名稱",
    password: "密碼",
    passwordPh: "輸入密碼",
    signInBtn: "登入",
    email: "電子郵件",
    emailPh: "your@email.com",
    company: "公司名稱",
    companyOpt: "（選填）",
    companyPh: "您的公司",
    passwordMin: "至少 6 個字元",
    confirmPw: "確認密碼",
    confirmPwPh: "再次輸入密碼",
    createBtn: "建立帳號",
    noAccount: "還沒有帳號？ 立即註冊",
    hasAccount: "已有帳號？ 登入",
    welcomeBack: "歡迎回來！",
    loginFailed: "登入失敗",
    invalidCreds: "帳號或密碼錯誤",
    regSuccess: "註冊成功！",
    regFailed: "註冊失敗",
    regRetry: "請重試",
     powered: "Powered by 開賣啦 SellCase",
    usernameReq: "請輸入使用者名稱",
    passwordReq: "請輸入密碼",
    usernameMin: "使用者名稱至少 3 個字元",
    emailInvalid: "請輸入有效的電子郵件",
    passwordMinLen: "密碼至少 6 個字元",
    confirmReq: "請確認密碼",
    passwordMismatch: "密碼不一致",
    chooseUsername: "選擇使用者名稱",
  },
  "zh-CN": {
    subtitle: "自动化研讨会平台",
    signInTitle: "登录",
    signInDesc: "登录管理您的研讨会",
    createTitle: "创建账号",
    createDesc: "立即开始自动化您的研讨会",
    username: "用户名",
    usernamePh: "输入用户名",
    password: "密码",
    passwordPh: "输入密码",
    signInBtn: "登录",
    email: "电子邮件",
    emailPh: "your@email.com",
    company: "公司名称",
    companyOpt: "（选填）",
    companyPh: "您的公司",
    passwordMin: "至少 6 个字符",
    confirmPw: "确认密码",
    confirmPwPh: "再次输入密码",
    createBtn: "创建账号",
    noAccount: "还没有账号？ 立即注册",
    hasAccount: "已有账号？ 登录",
    welcomeBack: "欢迎回来！",
    loginFailed: "登录失败",
    invalidCreds: "账号或密码错误",
    regSuccess: "注册成功！",
    regFailed: "注册失败",
    regRetry: "请重试",
     powered: "Powered by 開賣啦 SellCase",
    usernameReq: "请输入用户名",
    passwordReq: "请输入密码",
    usernameMin: "用户名至少 3 个字符",
    emailInvalid: "请输入有效的电子邮件",
    passwordMinLen: "密码至少 6 个字符",
    confirmReq: "请确认密码",
    passwordMismatch: "密码不一致",
    chooseUsername: "选择用户名",
  },
  "en": {
    subtitle: "Automated Webinar Platform",
    signInTitle: "Sign In",
    signInDesc: "Sign in to manage your webinars",
    createTitle: "Create Account",
    createDesc: "Start automating your webinars today",
    username: "Username",
    usernamePh: "Enter username",
    password: "Password",
    passwordPh: "Enter password",
    signInBtn: "Sign In",
    email: "Email",
    emailPh: "your@email.com",
    company: "Company Name",
    companyOpt: "(optional)",
    companyPh: "Your company",
    passwordMin: "At least 6 characters",
    confirmPw: "Confirm Password",
    confirmPwPh: "Confirm password",
    createBtn: "Create Account",
    noAccount: "Don't have an account? Sign up",
    hasAccount: "Already have an account? Sign in",
    welcomeBack: "Welcome back!",
    loginFailed: "Login failed",
    invalidCreds: "Invalid credentials",
    regSuccess: "Registration successful!",
    regFailed: "Registration failed",
    regRetry: "Please try again",
     powered: "Powered by 開賣啦 SellCase",
    usernameReq: "Please enter username",
    passwordReq: "Please enter password",
    usernameMin: "Username must be at least 3 characters",
    emailInvalid: "Please enter a valid email",
    passwordMinLen: "Password must be at least 6 characters",
    confirmReq: "Please confirm your password",
    passwordMismatch: "Passwords do not match",
    chooseUsername: "Choose a username",
  },
};

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verificationUsername, setVerificationUsername] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [isResending, setIsResending] = useState(false);
  const { lang, setLang } = useLang();
  const [langOpen, setLangOpen] = useState(false);

  const s = t[lang];

  const loginSchema = useMemo(() => z.object({
    username: z.string().min(1, s.usernameReq),
    password: z.string().min(1, s.passwordReq),
  }), [lang]);

  const registerSchema = useMemo(() => z.object({
    username: z.string().min(3, s.usernameMin),
    email: z.string().email(s.emailInvalid),
    password: z.string().min(6, s.passwordMinLen),
    confirmPassword: z.string().min(1, s.confirmReq),
    companyName: z.string().optional(),
  }).refine((data) => data.password === data.confirmPassword, {
    message: s.passwordMismatch,
    path: ["confirmPassword"],
  }), [lang]);

  type LoginForm = { username: string; password: string };
  type RegisterForm = { username: string; email: string; password: string; confirmPassword: string; companyName?: string };

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const registerForm = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: "", email: "", password: "", confirmPassword: "", companyName: "" },
  });

  const onLogin = async (data: LoginForm) => {
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/admin/login", data);
      toast({ title: s.welcomeBack });
      setLocation("/admin/dashboard");
    } catch (error: any) {
      if (error.message?.includes("EMAIL_VERIFICATION_REQUIRED")) {
        setVerificationRequired(true);
        setVerificationUsername(data.username);
        return;
      }
      toast({
        title: s.loginFailed,
        description: error.message || s.invalidCreds,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const onRegister = async (data: RegisterForm) => {
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/admin/register", {
        username: data.username,
        email: data.email,
        password: data.password,
        companyName: data.companyName || "",
      });
      setVerificationRequired(true);
      setVerificationUsername(data.username);
      setVerificationEmail(data.email);
      setMode("login");
      toast({ title: s.regSuccess, description: lang === "en" ? "Check your email to verify your account before signing in." : "請查看電子郵件並完成驗證後再登入。" });
    } catch (error: any) {
      toast({
        title: s.regFailed,
        description: error.message || s.regRetry,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resendVerification = async () => {
    if (!verificationEmail) return;
    setIsResending(true);
    try {
      await apiRequest("POST", "/api/admin/resend-verification", { email: verificationEmail });
      toast({ title: lang === "en" ? "Verification email sent" : "驗證信已寄出", description: lang === "en" ? "Please check your inbox." : "請查看收件匣。" });
    } catch (error: any) {
      toast({ title: lang === "en" ? "Unable to resend email" : "無法重新寄送驗證信", description: error.message, variant: "destructive" });
    } finally { setIsResending(false); }
  };

  useEffect(() => {
    if (!langOpen) return;
    const handler = () => setLangOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [langOpen]);

  return (
    <div className="admin-login min-h-[100dvh] flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="absolute top-4 right-4 relative" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLangOpen(!langOpen)}
          className="text-white/70"
          data-testid="button-login-lang-toggle"
        >
          <Languages className="w-4 h-4" />
        </Button>
        {langOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border bg-popover p-1 shadow-md">
            {(["zh-TW", "zh-CN", "en"] as LangFull[]).map((l) => (
              <button
                key={l}
                onClick={() => { setLang(l); setLangOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm rounded-sm hover-elevate flex items-center justify-between gap-2 ${lang === l ? "bg-accent text-accent-foreground" : ""}`}
                data-testid={`button-login-lang-${l}`}
              >
                <span>{langLabels[l]}</span>
                <span className="text-xs text-muted-foreground">{langShort[l]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="admin-login-brand mb-8 text-center">
        <div className="admin-login-logo-panel mb-4">
          <SellCaseLogo className="h-auto w-full" />
          <h1 className="sr-only">開賣啦 SellCase｜AI 自動銷講成交系統</h1>
        </div>
        <p className="text-slate-400 text-sm">{s.subtitle}</p>
      </div>

      <Card className="admin-login-card max-w-md w-full">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-xl">
            {mode === "login" ? s.signInTitle : s.createTitle}
          </CardTitle>
          <CardDescription>
            {mode === "login" ? s.signInDesc : s.createDesc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "login" ? (
            <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
              {verificationRequired && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 space-y-3 dark:bg-amber-950/30 dark:text-amber-100">
                  <div className="flex gap-2">
                    <MailCheck className="h-5 w-5 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">{lang === "en" ? "Verify your email to continue" : "請先驗證電子郵件"}</p>
                      <p>{lang === "en" ? `The account “${verificationUsername}” needs email verification.` : `帳號「${verificationUsername}」需要完成電子郵件驗證。`}</p>
                    </div>
                  </div>
                  <Input type="email" value={verificationEmail} onChange={(e) => setVerificationEmail(e.target.value)} placeholder={lang === "en" ? "Account email address" : "帳號電子郵件"} autoComplete="email" />
                  <Button type="button" size="sm" variant="outline" className="w-full" disabled={!verificationEmail || isResending} onClick={resendVerification} data-testid="button-resend-verification">
                    {isResending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{lang === "en" ? "Resend verification email" : "重新寄送驗證信"}
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="login-username">{s.username}</Label>
                <Input id="login-username" placeholder={s.usernamePh} autoComplete="username" {...loginForm.register("username")} data-testid="input-username" />
                {loginForm.formState.errors.username && (
                  <p className="text-sm font-medium text-destructive">{loginForm.formState.errors.username.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">{s.password}</Label>
                <Input id="login-password" type="password" placeholder={s.passwordPh} autoComplete="current-password" {...loginForm.register("password")} data-testid="input-password" />
                {loginForm.formState.errors.password && (
                  <p className="text-sm font-medium text-destructive">{loginForm.formState.errors.password.message}</p>
                )}
              </div>
              <div className="text-right">
                <button type="button" onClick={() => setLocation("/forgot-password")} className="text-sm font-medium text-primary hover:underline" data-testid="link-forgot-password">
                  {lang === "en" ? "Forgot password?" : "忘記密碼？"}
                </button>
              </div>
              <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-login">
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {s.signInBtn}
              </Button>
            </form>
          ) : (
            <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reg-username">{s.username}</Label>
                <Input id="reg-username" placeholder={s.chooseUsername} autoComplete="username" {...registerForm.register("username")} data-testid="input-reg-username" />
                {registerForm.formState.errors.username && (
                  <p className="text-sm font-medium text-destructive">{registerForm.formState.errors.username.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-email">{s.email}</Label>
                <Input id="reg-email" type="email" placeholder={s.emailPh} autoComplete="email" {...registerForm.register("email")} data-testid="input-reg-email" />
                {registerForm.formState.errors.email && (
                  <p className="text-sm font-medium text-destructive">{registerForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-company">{s.company} <span className="text-muted-foreground text-xs">{s.companyOpt}</span></Label>
                <Input id="reg-company" placeholder={s.companyPh} autoComplete="organization" {...registerForm.register("companyName")} data-testid="input-reg-company" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-password">{s.password}</Label>
                <Input id="reg-password" type="password" placeholder={s.passwordMin} autoComplete="new-password" {...registerForm.register("password")} data-testid="input-reg-password" />
                {registerForm.formState.errors.password && (
                  <p className="text-sm font-medium text-destructive">{registerForm.formState.errors.password.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-confirm">{s.confirmPw}</Label>
                <Input id="reg-confirm" type="password" placeholder={s.confirmPwPh} autoComplete="new-password" {...registerForm.register("confirmPassword")} data-testid="input-reg-confirm" />
                {registerForm.formState.errors.confirmPassword && (
                  <p className="text-sm font-medium text-destructive">{registerForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-register">
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {s.createBtn}
              </Button>
            </form>
          )}

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="text-sm font-semibold text-primary transition-colors hover:text-teal-700 hover:underline"
              data-testid="button-toggle-mode"
            >
              {mode === "login" ? s.noAccount : s.hasAccount}
            </button>
          </div>
        </CardContent>
      </Card>

      <p className="mt-6 text-slate-500 text-xs">
        {s.powered}
      </p>
    </div>
  );
}
