import { Switch, Route, useLocation } from "wouter";
import { ClerkProvider, AuthenticateWithRedirectCallback, useAuth } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { useEffect, useRef, useState } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Landing from "@/pages/landing";
import { FeatureDetail, FeaturesPage, SolutionDetail, SolutionsPage } from "@/pages/marketing-pages";
import NotFound from "@/pages/not-found";
import Registration from "@/pages/registration";
import WebinarRoom from "@/pages/webinar-room";
import AdminLogin from "@/pages/admin-login";
import AdminDashboard from "@/pages/admin-dashboard";
import AdminWebinarDetail from "@/pages/admin-webinar-detail";
import AdminAiAssistant from "@/pages/admin-ai-assistant";
import AdminControl from "@/pages/admin-control";
import EmbedRegister from "@/pages/embed-register";
import EmbedWebinar from "@/pages/embed-webinar";
import SuperAdmin from "@/pages/super-admin";
import Legal from "@/pages/legal";
import VerifyEmail from "@/pages/verify-email";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import SalesPage from "@/pages/sales-page";
import SalesPageEditor from "@/pages/sales-page-editor";
import PurchaseResult from "@/pages/purchase-result";
import LandingPageEditor from "@/pages/landing-page-editor";
import AdminProducts from "@/pages/admin-products";
import AdminOrders from "@/pages/admin-orders";
import AdminMedia from "@/pages/admin-media";
import PricingPage from "@/pages/pricing";
import { PlatformPixel } from "@/components/platform-pixel";
import { SupportContactBubble } from "@/components/support-contact-bubble";
import CourseMarketplace from "@/pages/course-marketplace";
import { apiRequest, clearAuthScopedQueryCache } from "./lib/queryClient";
import { trackPlatformConversion, type PlatformConversion } from "./lib/platform-conversions";
import { readMarketingConsent } from "./lib/marketing-consent";
import { Button } from "@/components/ui/button";
import { useLang } from "@/hooks/use-lang";
import OAuthConsent from "@/pages/oauth-consent";
import AuthorizedApps from "@/pages/authorized-apps";
import { postLoginDestination } from "@/lib/oauth-return";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function ClerkCallback() {
  return <AuthenticateWithRedirectCallback />;
}

function ClerkComplete() {
  const { isLoaded, isSignedIn } = useAuth();
  const { lang } = useLang();
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const posted = useRef(false);
  const text = lang === "en"
    ? { waiting: "Completing Google sign-in…", failed: "Unable to complete sign-in", retry: "Return to sign in" }
    : lang === "zh-CN"
      ? { waiting: "正在完成 Google 登录…", failed: "无法完成登录", retry: "返回登录" }
      : { waiting: "正在完成 Google 登入…", failed: "無法完成登入", retry: "返回登入" };

  useEffect(() => {
    if (!isLoaded || !isSignedIn || posted.current) return;
    posted.current = true;
    void (async () => {
      try {
        const response = await apiRequest("POST", "/api/admin/clerk-bridge");
        const result = await response.json() as { conversion?: PlatformConversion };
        await clearAuthScopedQueryCache();
        if (result.conversion) trackPlatformConversion(result.conversion, readMarketingConsent());
        setLocation(postLoginDestination());
      } catch (cause: any) {
        posted.current = false;
        setError(cause?.message || text.failed);
      }
    })();
  }, [isLoaded, isSignedIn, setLocation, text.failed]);

  if (!isLoaded) {
    return <div className="min-h-[100dvh] grid place-items-center p-6 text-center">{text.waiting}</div>;
  }
  if (!isSignedIn && !error) {
    return (
      <div className="min-h-[100dvh] grid place-items-center p-6 text-center">
        <div className="space-y-4">
          <p className="text-destructive">{text.failed}</p>
          <Button variant="outline" onClick={() => setLocation("/admin")}>{text.retry}</Button>
        </div>
      </div>
    );
  }
  if (!error) {
    return <div className="min-h-[100dvh] grid place-items-center p-6 text-center">{text.waiting}</div>;
  }
  return (
    <div className="min-h-[100dvh] grid place-items-center p-6 text-center">
      <div className="space-y-4">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" onClick={() => setLocation("/admin")}>{text.retry}</Button>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      {/* Embed Routes (minimal UI for iframe) */}
      <Route path="/sign-in/*?" component={ClerkCallback} />
      <Route path="/embed/register/:id" component={EmbedRegister} />
      <Route path="/embed/webinar/:id" component={EmbedWebinar} />
      
      {/* Public Routes */}
      <Route path="/register/:id" component={Registration} />
       {/* This is the permanent built-in form. /register is the marketing entry
           and may be redirected by the server's published journey snapshot. */}
       <Route path="/form/:id" component={Registration} />
      <Route path="/webinar/:id" component={WebinarRoom} />
      <Route path="/legal/:kind" component={Legal} />
       <Route path="/pricing" component={PricingPage} />
        <Route path="/courses" component={CourseMarketplace} />
       <Route path="/features" component={FeaturesPage} />
       <Route path="/features/:slug" component={FeatureDetail} />
       <Route path="/solutions" component={SolutionsPage} />
       <Route path="/solutions/:slug" component={SolutionDetail} />
       <Route path="/verify-email" component={VerifyEmail} />
       <Route path="/forgot-password" component={ForgotPassword} />
       <Route path="/reset-password" component={ResetPassword} />
       <Route path="/sales/:slug" component={SalesPage} />
       <Route path="/purchase-result" component={PurchaseResult} />
      
      {/* Admin Routes */}
      <Route path="/oauth/consent" component={OAuthConsent} />
      <Route path="/admin/settings/authorized-apps" component={AuthorizedApps} />
      <Route path="/admin" component={AdminLogin} />
      <Route path="/admin/clerk-complete" component={ClerkComplete} />
      <Route path="/admin/dashboard" component={AdminDashboard} />
       <Route path="/admin/webinar/:id/ai" component={AdminAiAssistant} />
       <Route path="/admin/webinar/:id" component={AdminWebinarDetail} />
      <Route path="/admin/webinar/:id/control" component={AdminControl} />
       <Route path="/admin/webinar/:id/landing-page" component={LandingPageEditor} />
       <Route path="/admin/webinar/:id/sales/:pageId" component={SalesPageEditor} />
       <Route path="/admin/products/sales/:pageId" component={SalesPageEditor} />
       <Route path="/admin/products" component={AdminProducts} />
        <Route path="/admin/orders" component={AdminOrders} />
       <Route path="/admin/media" component={AdminMedia} />
      <Route path="/super-admin" component={SuperAdmin} />
      
      {/* Landing Page */}
      <Route path="/" component={Landing} />
      
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      signInUrl="/admin"
      signUpUrl="/admin"
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
          <SupportContactBubble />
          <PlatformPixel />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
