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
import { apiRequest, clearAuthScopedQueryCache } from "@/lib/queryClient";
import { rememberOAuthRequest, postLoginDestination } from "@/lib/oauth-return";
import { Loader2, Languages, MailCheck } from "lucide-react";
import { useLang, type LangFull } from "@/hooks/use-lang";
import { SellCaseLogo } from "@/components/sellcase-logo";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { NO_CARD_TRIAL_AI_CALL_LIMIT, NO_CARD_TRIAL_DAYS } from "@shared/noCardTrial";
import { useMarketingConsent } from "@/components/marketing-consent";
import { flushPlatformConversions, trackPlatformConversion, type PlatformConversion } from "@/lib/platform-conversions";
import { useSignIn, useSignUp } from "@clerk/react/legacy";

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
    googleLogin: "透過 Google 帳號登入",
    googleSignup: "透過 Google 帳號註冊",
    googleFailed: "Google 登入失敗，請稍後再試",
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
    googleLogin: "通过 Google 帐号登录",
    googleSignup: "通过 Google 帐号注册",
    googleFailed: "Google 登录失败，请稍后再试",
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
    googleLogin: "Continue with Google",
    googleSignup: "Sign up with Google",
    googleFailed: "Google sign-in failed. Please try again.",
  },
};

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.89-1.74 2.99-4.3 2.99-7.36Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.89 6.62-2.41l-3.22-2.51c-.89.6-2.02.96-3.4.96-2.61 0-4.83-1.76-5.62-4.13H3.05v2.59A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.38 13.91A6 6 0 0 1 6.06 12c0-.66.11-1.31.32-1.91V7.5H3.05A10 10 0 0 0 2 12c0 1.61.38 3.13 1.05 4.5l3.33-2.59Z" />
      <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.83 1.49l2.87-2.87C16.97 2.9 14.7 2 12 2a10 10 0 0 0-8.95 5.5l3.33 2.59C7.17 7.72 9.39 5.96 12 5.96Z" />
    </svg>
  );
}

function GoogleAuthButton({ mode, label, failed, onError }: {
  mode: "login" | "register";
  label: string;
  failed: string;
  onError: (message: string) => void;
}) {
  const { isLoaded: signInLoaded, signIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const [loading, setLoading] = useState(false);
  const authenticate = async () => {
    setLoading(true);
    try {
      if (mode === "login") {
        if (!signInLoaded || !signIn) throw new Error(failed);
        await signIn.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: "/sign-in/sso-callback",
          redirectUrlComplete: "/admin/clerk-complete",
        });
      } else {
        if (!signUpLoaded || !signUp) throw new Error(failed);
        await signUp.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: "/sign-in/sso-callback",
          redirectUrlComplete: "/admin/clerk-complete",
        });
      }
    } catch {
      setLoading(false);
      onError(failed);
    }
  };
  return (
    <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={authenticate}
      data-testid={`button-google-${mode}`} aria-busy={loading}>
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleMark />}
      <span className="ml-2">{label}</span>
    </Button>
  );
}

export default function AdminLogin() {
  // Retained across Google's full-page redirect in this browser tab only.
  useEffect(() => { rememberOAuthRequest(); }, []);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verificationUsername, setVerificationUsername] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const { lang, setLang } = useLang();
  const [langOpen, setLangOpen] = useState(false);
  const [signupConversion, setSignupConversion] = useState<PlatformConversion | null>(null);
  const marketingConsent = useMarketingConsent();

  const s = t[lang];
  const googleError = useCallback((message: string) => {
    toast({ title: s.loginFailed, description: message, variant: "destructive" });
  }, [s.loginFailed, toast]);

  useEffect(() => {
    if (signupConversion) flushPlatformConversions(signupConversion.accountMarker, marketingConsent);
  }, [signupConversion, marketingConsent]);

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
      // Login can happen in the same SPA tab after another account logged out.
      // Remove all API query data before the dashboard's auth/me query mounts.
      await clearAuthScopedQueryCache();
      toast({ title: s.welcomeBack });
      setLocation(postLoginDestination());
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
      const response = await apiRequest("POST", "/api/admin/register", {
        username: data.username,
        email: data.email,
        password: data.password,
        companyName: data.companyName || "",
      });
      const result = await response.json() as { conversion?: PlatformConversion };
      await clearAuthScopedQueryCache();
      if (result.conversion?.eventName === "CompleteRegistration") {
        setSignupConversion(result.conversion);
        trackPlatformConversion(result.conversion, marketingConsent);
      }
      setVerificationRequired(true);
      setVerificationUsername(data.username);
      setVerificationEmail(data.email);
      setMode("login");
      toast({ title: s.regSuccess, description: lang === "en" ? "Enter the six-digit code sent to your email." : "請輸入寄到信箱的六位數驗證碼。" });
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
      setVerificationCode("");
      toast({ title: lang === "en" ? "Verification code sent" : "驗證碼已寄出", description: lang === "en" ? "Please check your inbox." : "請查看收件匣。" });
    } catch (error: any) {
      toast({ title: lang === "en" ? "Unable to resend code" : "無法重新寄送驗證碼", description: error.message, variant: "destructive" });
    } finally { setIsResending(false); }
  };

  const verifyEmailCode = async () => {
    if (!verificationEmail || verificationCode.length !== 6) return;
    setIsVerifying(true);
    try {
      await apiRequest("POST", "/api/admin/verify-email", {
        email: verificationEmail,
        code: verificationCode,
      });
      setVerificationRequired(false);
      setVerificationCode("");
      toast({
        title: lang === "en" ? "Email verified" : "電子郵件驗證完成",
        description: lang === "en" ? "You can now sign in." : "現在可以使用帳號密碼登入。",
      });
    } catch (error: any) {
      toast({
        title: lang === "en" ? "Invalid verification code" : "驗證碼錯誤或已過期",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
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
                      <p className="font-semibold">{lang === "en" ? "Enter your verification code" : "輸入電子郵件驗證碼"}</p>
                      <p>{lang === "en" ? `Enter the six-digit code sent for “${verificationUsername}”.` : `請輸入寄給帳號「${verificationUsername}」的六位數驗證碼。`}</p>
                    </div>
                  </div>
                  <Input type="email" value={verificationEmail} onChange={(e) => setVerificationEmail(e.target.value)} placeholder={lang === "en" ? "Account email address" : "帳號電子郵件"} autoComplete="email" />
                  <InputOTP
                    maxLength={6}
                    value={verificationCode}
                    onChange={(value) => setVerificationCode(value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    containerClassName="justify-center"
                  >
                    <InputOTPGroup>
                      {Array.from({ length: 6 }, (_, index) => (
                        <InputOTPSlot key={index} index={index} className="h-11 w-11 bg-white text-base" />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                  <Button type="button" size="sm" className="w-full" disabled={!verificationEmail || verificationCode.length !== 6 || isVerifying} onClick={verifyEmailCode} data-testid="button-verify-email">
                    {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{lang === "en" ? "Verify email" : "驗證電子郵件"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="w-full" disabled={!verificationEmail || isResending} onClick={resendVerification} data-testid="button-resend-verification">
                    {isResending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{lang === "en" ? "Resend verification code" : "重新寄送驗證碼"}
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
              <GoogleAuthButton mode="login" label={s.googleLogin} failed={s.googleFailed} onError={googleError} />
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
              <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-center text-xs leading-5 text-emerald-950" data-testid="text-no-card-trial-signup">
                {lang === "en"
                  ? `No card required: your new account starts a ${NO_CARD_TRIAL_DAYS}-day trial with one published product page and ${NO_CARD_TRIAL_AI_CALL_LIMIT} AI calls. It ends without a charge.`
                  : lang === "zh-CN"
                    ? `免信用卡：新账号自动开始 ${NO_CARD_TRIAL_DAYS} 天试用，含 1 个已发布商品页与 ${NO_CARD_TRIAL_AI_CALL_LIMIT} 次 AI；到期不扣款。`
                    : `免信用卡：新帳號自動開始 ${NO_CARD_TRIAL_DAYS} 天試用，含 1 個已發布商品頁與 ${NO_CARD_TRIAL_AI_CALL_LIMIT} 次 AI；到期不扣款。`}
              </p>
              <GoogleAuthButton mode="register" label={s.googleSignup} failed={s.googleFailed} onError={googleError} />
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
