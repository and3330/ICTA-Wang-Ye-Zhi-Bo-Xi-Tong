import { Switch, Route } from "wouter";
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
import { MarketingConsentBanner } from "@/components/marketing-consent";

function Router() {
  return (
    <Switch>
      {/* Embed Routes (minimal UI for iframe) */}
      <Route path="/embed/register/:id" component={EmbedRegister} />
      <Route path="/embed/webinar/:id" component={EmbedWebinar} />
      
      {/* Public Routes */}
      <Route path="/register/:id" component={Registration} />
      <Route path="/webinar/:id" component={WebinarRoom} />
      <Route path="/legal/:kind" component={Legal} />
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
      <Route path="/admin" component={AdminLogin} />
      <Route path="/admin/dashboard" component={AdminDashboard} />
      <Route path="/admin/webinar/:id" component={AdminWebinarDetail} />
      <Route path="/admin/webinar/:id/control" component={AdminControl} />
       <Route path="/admin/webinar/:id/landing-page" component={LandingPageEditor} />
       <Route path="/admin/webinar/:id/sales/:pageId" component={SalesPageEditor} />
       <Route path="/admin/products/sales/:pageId" component={SalesPageEditor} />
       <Route path="/admin/products" component={AdminProducts} />
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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
        <MarketingConsentBanner />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
