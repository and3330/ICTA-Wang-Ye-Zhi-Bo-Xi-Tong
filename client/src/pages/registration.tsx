import { RoomOpenGate } from "@/components/room-open-gate";
import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Calendar, CheckCircle, Loader2, Play, Zap, Users } from "lucide-react";
import type { Webinar } from "@shared/schema";
import { WebinarTrackingProvider, type TrackingWebinar } from "@/components/webinar-tracking-provider";
import { getWebinarVisitorToken, openTrackedExternalUrl, trackWebinarEvent, trackCompletedWebinarRegistration } from "@/lib/webinar-tracking";
import { getWatchToken, saveWatchAccess, watchUrl } from "@/lib/watch-access";
import { LandingCountdown as Countdown, WebinarLanding } from "@/components/webinar-landing";
import type { PlaybackSource } from "@/lib/media";

type CustomField = { id: string; label: string; type: "text" | "textarea" | "select" | "checkbox"; required: boolean; options?: string[] };
type LandingBlock = { id?: string; type: string; enabled?: boolean; [key: string]: any };


interface AvailableSessionsResponse {
  mode: "fixed" | "recurring" | "onDemand" | "justInTime";
  sessions: Array<{ id: string; scheduledStart: string; status: string }>;
  nextStartMinutes?: number;
  message?: string;
  hasSessions?: boolean;
  onDemandAvailable?: boolean;
  registrationOpen?: boolean;
  jitSelectionToken?: string;
}

const ON_DEMAND_VALUE = "__on_demand__";

const registrationSchema = z.object({
  name: z.string().min(2, "姓名至少需要2個字"),
  phone: z.string().min(1, "請輸入電話號碼"),
  email: z.string().email("請輸入有效的 Email"),
});

type RegistrationForm = z.infer<typeof registrationSchema>;


export default function Registration() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [registered, setRegistered] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, boolean>>({});

  const { data: webinar, isLoading } = useQuery<Webinar>({
    queryKey: ["/api/webinars", id],
    enabled: !!id,
  });
  const previewMode = new URLSearchParams(window.location.search).get("preview") === "1";
  const { data: landingResponse, isLoading: landingLoading, error: landingError } = useQuery<{ landingPage?: { blocks?: LandingBlock[]; brandSettings?: any }; mediaPlayback?: Record<string, PlaybackSource> }>({
    queryKey: previewMode ? ["/api/webinars", id, "landing-page", "preview"] : ["/api/webinars", id, "landing-page"],
    enabled: !!id,
  });

  const { data: availableSessions } = useQuery<AvailableSessionsResponse>({
    queryKey: ["/api/webinars", id, "available-sessions"],
    enabled: !!id,
  });

  const { data: regCount } = useQuery<{ count: number }>({
    queryKey: ["/api/webinars", id, "registration-count"],
    enabled: !!id,
  });

  useEffect(() => {
    if (webinar && id) trackWebinarEvent(id, "landing_view");
  }, [webinar, id]);

  const form = useForm<RegistrationForm>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: RegistrationForm) => {
      const urlParams = new URLSearchParams(window.location.search);
      const payload: any = {
        ...data,
        webinarId: id,
        viewerTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        analyticsVisitorToken: id ? getWebinarVisitorToken(id) : undefined,
        utmSource: urlParams.get("utm_source") || undefined,
        utmMedium: urlParams.get("utm_medium") || undefined,
        utmCampaign: urlParams.get("utm_campaign") || undefined,
        utmTerm: urlParams.get("utm_term") || undefined,
        utmContent: urlParams.get("utm_content") || undefined,
        landingUrl: window.location.href,
      };
      if (selectedSession && selectedSession !== ON_DEMAND_VALUE) {
        payload.selectedSession = selectedSession;
        if (availableSessions?.mode === "justInTime" && availableSessions.jitSelectionToken) {
          payload.jitSelectionToken = availableSessions.jitSelectionToken;
        }
      }
      if (Object.keys(customFieldValues).length > 0) {
        payload.customFieldData = customFieldValues;
      }
      const response = await apiRequest("POST", "/api/registrations", payload);
      return response.json();
    },
    onSuccess: (response: any) => {
      saveWatchAccess(id!, response);
      setRegistered(true);
      toast({
        title: "報名成功！",
        description: response?.externalThankYouUnavailable
          ? "外部完成頁暫時無法開啟；報名已完成，請使用本頁的觀看按鈕。"
          : "確認信已發送到您的 Email",
      });
      // The server creates and validates this opaque handoff after persistence.
      // Never construct an external destination from contact or watch data.
      const redirectUrl = response?.externalThankYou?.redirectUrl;
      if (typeof redirectUrl === "string" && redirectUrl) {
        try {
          const destination = new URL(redirectUrl);
          if (destination.protocol === "https:") {
            window.location.assign(destination.toString());
            return; // The external handoff consumer owns its verified conversion.
          }
        } catch {
          // Keep the internal success/watch flow if the supplied destination
          // cannot be used by this browser.
        }
      }
      trackCompletedWebinarRegistration(id, response?.id);
    },
    onError: (error: any) => {
      toast({
        title: "報名失敗",
        description: error.message || "請稍後再試",
        variant: "destructive",
      });
    },
  });

  const webinarTimezone = webinar?.timezone || "Asia/Taipei";
  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleString("zh-TW", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: webinarTimezone,
    });
  };

  const formatSessionOption = (date: string | Date) => {
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: webinarTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(date));
  };

  useEffect(() => {
    if (
      availableSessions &&
      availableSessions.sessions.length === 1 &&
       !availableSessions.onDemandAvailable &&
      !selectedSession
    ) {
      setSelectedSession(availableSessions.sessions[0].scheduledStart);
    }
  }, [availableSessions, selectedSession]);

  if (isLoading || landingLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  if (!webinar) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #4338ca 0%, #7e22ce 50%, #be185d 100%)" }}>
        <Card className="max-w-md mx-auto">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">無法開啟此說明會。請確認 ID 是否正確、頁面是否已發布；草稿預覽需要擁有者登入。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (webinar.publishStatus !== "published" && !previewMode) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #4338ca 0%, #7e22ce 50%, #be185d 100%)" }}>
        <Card className="max-w-md mx-auto">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground" data-testid="text-webinar-not-published">{previewMode ? "此草稿預覽需要擁有者登入，或落地頁尚未建立。" : "此說明會尚未發布，暫時無法報名。"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (previewMode && (landingError || !landingResponse?.landingPage)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, #4338ca 0%, #7e22ce 50%, #be185d 100%)" }}>
        <Card className="max-w-md mx-auto">
          <CardContent className="pt-6 text-center">
            <p className="font-semibold">此說明會落地頁尚未發布</p>
            <p className="mt-2 text-sm text-muted-foreground">主辦人完成發布後，即可透過這個正式網址開放報名。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const landingPage = (landingResponse?.landingPage || (webinar as any).landingPage) as { blocks?: LandingBlock[]; brandSettings?: any } | null;
  const hasStickyCta = Boolean(landingPage?.blocks?.some((block) => block.type === "stickyCta" && block.enabled));
  const brandSettings = ((landingPage?.brandSettings || webinar.brandSettings) as { logo?: string; primaryColor?: string; secondaryColor?: string; backgroundColor?: string } | null);
  const brandGradient = brandSettings?.primaryColor && brandSettings?.secondaryColor
    ? { background: `linear-gradient(135deg, ${brandSettings.primaryColor} 0%, ${brandSettings.secondaryColor} 100%)` }
    : { background: "linear-gradient(135deg, #4338ca 0%, #7e22ce 50%, #be185d 100%)" };

  const mode = availableSessions?.mode || "fixed";
  const hasSessions = availableSessions?.hasSessions || false;
  const onDemandAvailable = Boolean(availableSessions?.onDemandAvailable);
  const registrationOpen = availableSessions?.registrationOpen !== false;
  const isOnDemandSelection = selectedSession === ON_DEMAND_VALUE;
  const showSessionPicker = Boolean(availableSessions && (onDemandAvailable || (hasSessions && availableSessions.sessions.length >= 1)));

  const customFields = (webinar.customFields as CustomField[]) || [];
  const scarcity = webinar.scarcitySettings as { countdownEnabled: boolean; seatsEnabled: boolean; totalSeats: number; urgencyText: string } | null;
  const thankYou = webinar.thankYouSettings as { enabled: boolean; headline: string; message: string; ctaText: string; ctaUrl: string } | null;

  const countdownTarget = selectedSession && selectedSession !== ON_DEMAND_VALUE
    ? new Date(selectedSession).getTime()
    : (!showSessionPicker && hasSessions && availableSessions?.sessions?.[0]?.scheduledStart
        ? new Date(availableSessions.sessions[0].scheduledStart).getTime()
        : (webinar.startTime ? new Date(webinar.startTime).getTime() : 0));
  const showCountdown = scarcity?.countdownEnabled && !isOnDemandSelection && countdownTarget > Date.now();

  const validateAndSubmit = (data: RegistrationForm) => {
    const errors: Record<string, boolean> = {};
    customFields.forEach((f) => {
      if (f.required) {
        const v = customFieldValues[f.id];
        if (f.type === "checkbox") {
          if (v !== "true") errors[f.id] = true;
        } else if (!v || !v.trim()) {
          errors[f.id] = true;
        }
      }
    });
    setCustomFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    registerMutation.mutate(data);
  };

  if (registered) {
    const tracking = webinar as Webinar & TrackingWebinar;
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={brandGradient}>
        <WebinarTrackingProvider webinarId={id} metaPixelId={tracking.metaPixelId} gtmContainerId={tracking.gtmContainerId} />
        <Card className="max-w-lg w-full">
          <CardContent className="pt-8 pb-8 text-center">
            {brandSettings?.logo && (
              <div className="flex justify-center mb-4">
                <img src={brandSettings.logo} alt="Logo" className="max-h-12 object-contain" />
              </div>
            )}
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold mb-2" data-testid="text-registration-success">
              {thankYou?.enabled && thankYou.headline ? thankYou.headline : "報名成功！"}
            </h2>
            <p className="text-muted-foreground mb-6">
              {thankYou?.enabled && thankYou.message
                ? thankYou.message
                : isOnDemandSelection
                  ? "我們已將觀看連結發送至您的 Email，您現在即可開始觀看。"
                  : "我們已將直播連結發送至您的 Email，請在直播時間準時加入。"}
            </p>
            <div className="bg-muted rounded-md p-4 mb-6 text-left">
              <h3 className="font-semibold mb-3 text-center">{webinar.title}</h3>
              {isOnDemandSelection ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <Play className="h-4 w-4 text-green-600" />
                  <span>隨時可以觀看</span>
                </div>
              ) : (
                <div className="border border-primary/30 bg-primary/5 rounded-md p-3" data-testid="card-selected-session">
                  <div className="text-xs text-muted-foreground mb-1">您報名的場次</div>
                  <div className="flex items-center gap-2 font-medium">
                    <Calendar className="h-4 w-4 text-primary flex-shrink-0" />
                    <span data-testid="text-selected-session-date">
                      {selectedSession ? formatSessionOption(selectedSession) : formatDate(webinar.startTime)}
                    </span>
                  </div>
                </div>
              )}
            </div>
            {thankYou?.enabled && thankYou.ctaText && thankYou.ctaUrl && (
              <Button
                onClick={() => { void openTrackedExternalUrl(id, thankYou.ctaUrl); }}
                className="w-full mb-3"
                data-testid="button-thankyou-cta"
              >
                {thankYou.ctaText}
              </Button>
            )}
            <RoomOpenGate start={selectedSession || webinar.startTime} onDemand={isOnDemandSelection}>
            <Button
              onClick={() => {
                trackWebinarEvent(id, "webinar_enter");
               const nextUrl = new URL(watchUrl(`/webinar/${id}`, id!, getWatchToken(id)));
               setLocation(`${nextUrl.pathname}${nextUrl.search}`);
              }}
              className="w-full"
              variant={thankYou?.enabled && thankYou.ctaText && thankYou.ctaUrl ? "outline" : "default"}
              data-testid="button-enter-webinar"
            >
              {isOnDemandSelection ? "立即觀看" : "進入直播間"}
            </Button>
            </RoomOpenGate>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`registration-page min-h-screen ${hasStickyCta ? "has-sticky-cta" : ""}`} style={{ ...brandGradient, background: brandSettings?.backgroundColor || brandGradient.background }}>
      <WebinarTrackingProvider
        webinarId={id}
        metaPixelId={(webinar as Webinar & TrackingWebinar).metaPixelId}
        gtmContainerId={(webinar as Webinar & TrackingWebinar).gtmContainerId}
      />
      {landingPage?.blocks?.length ? <WebinarLanding webinarId={id!} blocks={landingPage.blocks} brand={brandSettings} title={webinar.title} description={webinar.description || undefined} startTime={mode === "fixed" ? webinar.startTime : undefined} timezone={webinarTimezone} countdownTarget={countdownTarget} mediaPlayback={landingResponse?.mediaPlayback} onRegister={() => { document.getElementById("registration-form")?.scrollIntoView({ behavior: "smooth", block: "start" }); window.setTimeout(() => document.getElementById("input-name")?.focus(), 450); }} /> : <div className="mx-auto max-w-lg p-5 text-center text-sm text-muted-foreground">落地頁內容暫時無法載入，以下仍可完成報名。</div>}
      <Card id="registration-form" className="max-w-lg w-full mx-auto my-8">
        <CardHeader className="text-center">
          {brandSettings?.logo && (
            <div className="flex justify-center mb-2">
              <img src={brandSettings.logo} alt="Logo" className="max-h-12 object-contain" />
            </div>
          )}
          {webinar.coverImage && (
            <img
              src={webinar.coverImage}
              alt={webinar.title}
              className="w-full h-48 object-cover rounded-md mb-4"
            />
          )}
          <CardTitle className="text-2xl">{webinar.title}</CardTitle>
          {webinar.description && (
            <CardDescription className="text-base mt-2">
              {webinar.description}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {showCountdown && <Countdown target={countdownTarget} />}

          {scarcity?.seatsEnabled && (
            <div className="flex items-center justify-center gap-2 mb-6 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md" data-testid="card-scarcity-seats">
              <Users className="h-5 w-5 text-amber-600" />
              <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {scarcity.urgencyText || `名額有限，僅剩 ${Math.max(scarcity.totalSeats - (regCount?.count || 0), 1)} 個名額`}
              </span>
            </div>
          )}

          {!scarcity?.seatsEnabled && scarcity?.urgencyText && (
            <div className="flex items-center justify-center gap-2 mb-6 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md" data-testid="card-scarcity-urgency">
              <Zap className="h-5 w-5 text-amber-600" />
              <span className="text-sm font-medium text-amber-800 dark:text-amber-300">{scarcity.urgencyText}</span>
            </div>
          )}

          {onDemandAvailable && (
            <div className="flex items-center justify-center gap-2 mb-6 p-3 bg-muted rounded-md">
              <Play className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium">可選擇「隨到隨看」，或預約下方場次參加</span>
            </div>
          )}

          {mode === "justInTime" && (
            <div className="flex items-center justify-center gap-2 mb-6 p-3 bg-muted rounded-md">
              <Zap className="h-5 w-5 text-amber-500" />
              <span className="text-sm font-medium">
                {availableSessions?.message || `下一場即將開始`}
              </span>
            </div>
          )}

          {mode === "fixed" && !showSessionPicker && (
            <div className="flex items-center justify-center gap-6 mb-6 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>{formatDate(hasSessions && availableSessions?.sessions?.[0]?.scheduledStart ? availableSessions.sessions[0].scheduledStart : webinar.startTime)}</span>
              </div>
            </div>
          )}
          {!isOnDemandSelection && (
            <p className="mb-6 -mt-4 text-center text-xs text-muted-foreground" data-testid="text-webinar-timezone">
              所有場次時間均為 {webinarTimezone}
            </p>
          )}

          {showSessionPicker && (
            <div className="mb-6">
              <label className="text-sm font-medium mb-2 block">選擇觀看方式或場次</label>
              <Select
                value={selectedSession || ""}
                onValueChange={(val) => setSelectedSession(val)}
              >
                <SelectTrigger data-testid="select-session" className="w-full">
                  <SelectValue placeholder="請選擇隨到隨看或場次時段" />
                </SelectTrigger>
                <SelectContent>
                  {onDemandAvailable && (
                    <SelectItem value={ON_DEMAND_VALUE} data-testid="option-session-on-demand">
                      隨到隨看－報名後立即觀看
                    </SelectItem>
                  )}
                  {availableSessions?.sessions.map((session) => (
                    <SelectItem
                      key={session.id}
                      value={session.scheduledStart}
                      data-testid={`option-session-${session.id}`}
                    >
                      {session.id === "jit" ? `即時開始（約 ${availableSessions.nextStartMinutes} 分鐘後）－` : "預約場次－"}{formatSessionOption(session.scheduledStart)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!selectedSession && (
                <p className="text-xs text-destructive mt-2">請先選擇觀看方式或場次</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">場次時間：{webinarTimezone}</p>
            </div>
          )}
          {!registrationOpen && (
            <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-3 text-center text-sm text-amber-800" data-testid="text-registration-closed">
              目前沒有可報名的場次
            </div>
          )}

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(validateAndSubmit)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>姓名</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="請輸入您的姓名"
                        {...field}
                        data-testid="input-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>電話</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="請輸入您的電話號碼"
                        {...field}
                        data-testid="input-phone"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="your@email.com"
                        {...field}
                        data-testid="input-email"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {customFields.map((cf) => (
                <div key={cf.id} className="space-y-2" data-testid={`field-custom-${cf.id}`}>
                  {cf.type !== "checkbox" && (
                    <Label className="text-sm font-medium">
                      {cf.label}
                      {cf.required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                  )}
                  {cf.type === "text" && (
                    <Input
                      value={customFieldValues[cf.id] || ""}
                      onChange={(e) => setCustomFieldValues((prev) => ({ ...prev, [cf.id]: e.target.value }))}
                      placeholder={cf.label}
                      data-testid={`input-custom-${cf.id}`}
                    />
                  )}
                  {cf.type === "textarea" && (
                    <Textarea
                      value={customFieldValues[cf.id] || ""}
                      onChange={(e) => setCustomFieldValues((prev) => ({ ...prev, [cf.id]: e.target.value }))}
                      placeholder={cf.label}
                      rows={3}
                      data-testid={`input-custom-${cf.id}`}
                    />
                  )}
                  {cf.type === "select" && (
                    <Select
                      value={customFieldValues[cf.id] || ""}
                      onValueChange={(v) => setCustomFieldValues((prev) => ({ ...prev, [cf.id]: v }))}
                    >
                      <SelectTrigger data-testid={`select-custom-${cf.id}`}>
                        <SelectValue placeholder={cf.label} />
                      </SelectTrigger>
                      <SelectContent>
                        {(cf.options || []).map((opt, i) => (
                          <SelectItem key={i} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {cf.type === "checkbox" && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={customFieldValues[cf.id] === "true"}
                        onCheckedChange={(v) => setCustomFieldValues((prev) => ({ ...prev, [cf.id]: v ? "true" : "false" }))}
                        data-testid={`checkbox-custom-${cf.id}`}
                      />
                      <Label className="text-sm font-medium">
                        {cf.label}
                        {cf.required && <span className="text-destructive ml-1">*</span>}
                      </Label>
                    </div>
                  )}
                  {customFieldErrors[cf.id] && (
                    <p className="text-xs text-destructive" data-testid={`error-custom-${cf.id}`}>此欄位為必填</p>
                  )}
                </div>
              ))}

              <Button
                type="submit"
                className="w-full"
                disabled={registerMutation.isPending || !registrationOpen || (showSessionPicker && !selectedSession)}
                data-testid="button-register"
              >
                {registerMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    報名中...
                  </>
                ) : (
                  "立即報名"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
