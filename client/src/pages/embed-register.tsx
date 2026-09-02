import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest } from "@/lib/queryClient";
import { Calendar, Clock, CheckCircle, Loader2, Play, Zap, ChevronDown, Users } from "lucide-react";
import type { Webinar } from "@shared/schema";
import { WebinarTrackingProvider, type TrackingWebinar } from "@/components/webinar-tracking-provider";
import { getWebinarVisitorToken, openTrackedExternalUrl, trackWebinarEvent } from "@/lib/webinar-tracking";

type CustomField = { id: string; label: string; type: "text" | "textarea" | "select" | "checkbox"; required: boolean; options?: string[] };

interface AvailableSessionsResponse {
  mode: "fixed" | "recurring" | "onDemand" | "justInTime";
  sessions: Array<{ id: string; scheduledStart: string; status: string }>;
  nextStartMinutes?: number;
  message?: string;
  hasSessions?: boolean;
  onDemandAvailable?: boolean;
}

const ON_DEMAND_VALUE = "__on_demand__";

const registrationSchema = z.object({
  name: z.string().min(2, "姓名至少需要2個字"),
  phone: z.string().min(1, "請輸入電話號碼"),
  email: z.string().email("請輸入有效的 Email"),
});

type RegistrationForm = z.infer<typeof registrationSchema>;

function Countdown({ target }: { target: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const ms = target - now;
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return (
    <div className="mb-4 p-3 bg-primary/5 border border-primary/20 rounded-md" data-testid="card-embed-countdown">
      <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-primary mb-2">
        <Clock className="h-3.5 w-3.5" />
        <span>距離開始還有</span>
      </div>
      <div className="flex items-center justify-center gap-2 text-center">
        {[
          { v: days, l: "天" },
          { v: hours, l: "時" },
          { v: mins, l: "分" },
          { v: secs, l: "秒" },
        ].map((u, i) => (
          <div key={i} className="flex flex-col items-center">
            <span className="text-lg font-bold tabular-nums">{String(u.v).padStart(2, "0")}</span>
            <span className="text-[10px] text-muted-foreground">{u.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EmbedRegister() {
  const { id } = useParams<{ id: string }>();
  const [registered, setRegistered] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, boolean>>({});

  const { data: webinar, isLoading } = useQuery<Webinar>({
    queryKey: ["/api/webinars", id],
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
    defaultValues: { name: "", phone: "", email: "" },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: RegistrationForm) => {
      const urlParams = new URLSearchParams(window.location.search);
      const payload: any = {
        ...data,
        webinarId: id,
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
      }
      if (Object.keys(customFieldValues).length > 0) {
        payload.customFieldData = customFieldValues;
      }
      return apiRequest("POST", "/api/registrations", payload);
    },
    onSuccess: () => {
      setRegistered(true);
      setErrorMessage(null);
      try {
        window.parent.postMessage({ type: "livecast:registered", webinarId: id }, "*");
      } catch {}
    },
    onError: (error: any) => {
      setErrorMessage(error.message || "報名失敗，請稍後再試");
    },
  });

  useEffect(() => {
    let lastHeight = 0;
    const sendHeight = () => {
      try {
        const height = document.documentElement.scrollHeight;
        if (height !== lastHeight) {
          lastHeight = height;
          window.parent.postMessage({ type: "livecast:resize", height }, "*");
        }
      } catch {}
    };
    sendHeight();
    const observer = new MutationObserver(sendHeight);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", sendHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sendHeight);
    };
  }, []);

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleString("zh-TW", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  const formatShortDate = (date: string | Date) => {
    const d = new Date(date);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return "今天";
    if (d.toDateString() === tomorrow.toDateString()) return "明天";
    return d.toLocaleString("zh-TW", { month: "short", day: "numeric", weekday: "short" });
  };

  const formatTimeWithZone = (date: string | Date) => {
    return new Date(date).toLocaleString("zh-TW", {
      hour: "2-digit", minute: "2-digit", timeZoneName: "short",
    });
  };

  const mode = availableSessions?.mode || "fixed";
  const hasSessions = availableSessions?.hasSessions || false;
  const hasMultipleSessions = hasSessions && availableSessions && availableSessions.sessions.length > 1;
  const onDemandAvailable = availableSessions?.onDemandAvailable || mode === "onDemand";
  const isOnDemandSelection = selectedSession === ON_DEMAND_VALUE || (mode === "onDemand" && !selectedSession);
  const showSessionChoice = Boolean(onDemandAvailable || hasMultipleSessions);

  const customFields = (webinar?.customFields as CustomField[]) || [];
  const scarcity = webinar?.scarcitySettings as { countdownEnabled: boolean; seatsEnabled: boolean; totalSeats: number; urgencyText: string } | null;
  const thankYou = webinar?.thankYouSettings as { enabled: boolean; headline: string; message: string; ctaText: string; ctaUrl: string } | null;

  const countdownTarget = selectedSession && selectedSession !== ON_DEMAND_VALUE
    ? new Date(selectedSession).getTime()
    : (!showSessionChoice && hasSessions && availableSessions?.sessions?.[0]?.scheduledStart
        ? new Date(availableSessions.sessions[0].scheduledStart).getTime()
        : (webinar?.startTime ? new Date(webinar.startTime).getTime() : 0));
  const showCountdown = scarcity?.countdownEnabled && !isOnDemandSelection && countdownTarget > Date.now();

  const validateAndSubmit = (data: RegistrationForm) => {
    setErrorMessage(null);
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

  const groupedSessions: Record<string, Array<{ id: string; scheduledStart: string; status: string }>> = {};
  if (availableSessions?.sessions) {
    for (const session of availableSessions.sessions) {
      const dateKey = formatShortDate(session.scheduledStart);
      if (!groupedSessions[dateKey]) groupedSessions[dateKey] = [];
      groupedSessions[dateKey].push(session);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!webinar) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <p className="text-muted-foreground text-sm">找不到此研討會</p>
      </div>
    );
  }

  const brandSettings = webinar.brandSettings as { logo?: string; primaryColor?: string; secondaryColor?: string } | null;
  const accentColor = brandSettings?.primaryColor || "#4f46e5";

  if (registered) {
    const tracking = webinar as Webinar & TrackingWebinar;
    return (
      <div className="p-6 text-center">
        <WebinarTrackingProvider webinarId={id} metaPixelId={tracking.metaPixelId} gtmContainerId={tracking.gtmContainerId} />
        <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="h-7 w-7 text-green-600" />
        </div>
        <h3 className="text-xl font-bold mb-2" data-testid="text-embed-success">
          {thankYou?.enabled && thankYou.headline ? thankYou.headline : "報名成功！"}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          {thankYou?.enabled && thankYou.message ? thankYou.message : "確認信已發送至您的 Email"}
        </p>
        <div className="bg-muted rounded-md p-3 mb-4">
          <h4 className="font-semibold text-sm mb-1">{webinar.title}</h4>
          {isOnDemandSelection ? (
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Play className="h-3 w-3" />
              <span>隨時可以觀看</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{selectedSession ? formatDate(selectedSession) : formatDate(webinar.startTime)}</span>
            </div>
          )}
        </div>
        {thankYou?.enabled && thankYou.ctaText && thankYou.ctaUrl && (
          <Button
            className="w-full mb-2"
            style={{ backgroundColor: accentColor }}
            onClick={() => openTrackedExternalUrl(id, thankYou.ctaUrl)}
            data-testid="button-embed-thankyou-cta"
          >
            {thankYou.ctaText}
          </Button>
        )}
        <Button
          className="w-full"
          variant={thankYou?.enabled && thankYou.ctaText && thankYou.ctaUrl ? "outline" : "default"}
          style={thankYou?.enabled && thankYou.ctaText && thankYou.ctaUrl ? undefined : { backgroundColor: accentColor }}
          onClick={() => {
            trackWebinarEvent(id, "webinar_enter");
            window.open(`${window.location.origin}/webinar/${id}`, "_blank", "noopener,noreferrer");
          }}
          data-testid="button-embed-enter-webinar"
        >
          {isOnDemandSelection ? "立即觀看" : "進入直播間"}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <WebinarTrackingProvider
        webinarId={id}
        metaPixelId={(webinar as Webinar & TrackingWebinar).metaPixelId}
        gtmContainerId={(webinar as Webinar & TrackingWebinar).gtmContainerId}
      />
      {brandSettings?.logo && (brandSettings.logo.startsWith("http://") || brandSettings.logo.startsWith("https://") || brandSettings.logo.startsWith("/")) && (
        <div className="flex justify-center mb-3">
          <img src={brandSettings.logo} alt="Logo" className="max-h-8 object-contain" />
        </div>
      )}

      {webinar.coverImage && (webinar.coverImage.startsWith("http://") || webinar.coverImage.startsWith("https://") || webinar.coverImage.startsWith("/")) && (
        <img
          src={webinar.coverImage}
          alt={webinar.title}
          className="w-full h-36 object-cover rounded-md mb-3"
          data-testid="img-embed-cover"
        />
      )}

      <h3 className="text-lg font-bold text-center mb-1" data-testid="text-embed-title">{webinar.title}</h3>
      {webinar.description && (
        <p className="text-xs text-muted-foreground text-center mb-3">{webinar.description}</p>
      )}

      {showCountdown && <Countdown target={countdownTarget} />}

      {scarcity?.seatsEnabled && (
        <div className="flex items-center justify-center gap-1.5 mb-4 p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md" data-testid="card-embed-scarcity-seats">
          <Users className="h-4 w-4 text-amber-600" />
          <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
            {scarcity.urgencyText || `名額有限，僅剩 ${Math.max(scarcity.totalSeats - (regCount?.count || 0), 1)} 個名額`}
          </span>
        </div>
      )}

      {!scarcity?.seatsEnabled && scarcity?.urgencyText && (
        <div className="flex items-center justify-center gap-1.5 mb-4 p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md" data-testid="card-embed-scarcity-urgency">
          <Zap className="h-4 w-4 text-amber-600" />
          <span className="text-xs font-medium text-amber-800 dark:text-amber-300">{scarcity.urgencyText}</span>
        </div>
      )}

      {onDemandAvailable && (
        <div className="flex items-center justify-center gap-1.5 mb-4 p-2.5 bg-muted rounded-md">
          <Play className="h-4 w-4 text-green-600" />
          <span className="text-xs font-medium">可選擇隨到隨看，或預約指定場次</span>
        </div>
      )}

      {mode === "justInTime" && (
        <div className="flex items-center justify-center gap-1.5 mb-4 p-2.5 bg-muted rounded-md">
          <Zap className="h-4 w-4 text-amber-500" />
          <span className="text-xs font-medium">
            {availableSessions?.message || "下一場即將開始"}
          </span>
        </div>
      )}

      {mode === "fixed" && !showSessionChoice && (
        <div className="flex items-center justify-center gap-1.5 mb-4 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>{formatDate(hasSessions && availableSessions?.sessions?.[0]?.scheduledStart ? availableSessions.sessions[0].scheduledStart : webinar.startTime)}</span>
        </div>
      )}

      {showSessionChoice && (
        <div className="mb-4 relative">
          <div
            className="border rounded-md p-2.5 flex items-center justify-between cursor-pointer hover-elevate"
            onClick={() => setShowSessionPicker(!showSessionPicker)}
            data-testid="button-embed-session-dropdown"
          >
            <span className="text-sm">
              {selectedSession === ON_DEMAND_VALUE ? (
                <span className="flex items-center gap-1.5">
                  <Play className="h-3.5 w-3.5 flex-shrink-0" />
                  隨到隨看－報名後立即觀看
                </span>
              ) : selectedSession ? (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                  {formatShortDate(selectedSession)} @ {formatTimeWithZone(selectedSession)}
                </span>
              ) : (
                <span className="text-muted-foreground">選擇隨到隨看或預約場次</span>
              )}
            </span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showSessionPicker ? "rotate-180" : ""}`} />
          </div>

          {showSessionPicker && (
            <div className="absolute left-0 right-0 top-full mt-1 border rounded-md bg-card shadow-lg z-50">
              <ScrollArea className="max-h-56">
                <div className="p-2 space-y-1">
                  {onDemandAvailable && (
                    <div
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer text-sm hover-elevate ${
                        selectedSession === ON_DEMAND_VALUE ? "bg-accent font-medium" : ""
                      }`}
                      onClick={() => {
                        setSelectedSession(ON_DEMAND_VALUE);
                        setShowSessionPicker(false);
                      }}
                      data-testid="button-embed-session-on-demand"
                    >
                      <Play className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                      <span>隨到隨看－報名後立即觀看</span>
                    </div>
                  )}
                  {Object.entries(groupedSessions).map(([dateLabel, sessions]) => (
                    <div key={dateLabel}>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2.5 py-1.5">{dateLabel}</p>
                      {sessions.map((session) => (
                        <div
                          key={session.id}
                          className={`flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer text-sm hover-elevate ${
                            selectedSession === session.scheduledStart ? "bg-accent font-medium" : ""
                          }`}
                          onClick={() => {
                            setSelectedSession(session.scheduledStart);
                            setShowSessionPicker(false);
                          }}
                          data-testid={`button-embed-session-${session.id}`}
                        >
                          <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          <span>{formatShortDate(session.scheduledStart)} @ {formatTimeWithZone(session.scheduledStart)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="border-t px-3 py-1.5 text-center">
                <span className="text-[10px] text-muted-foreground opacity-60">Powered by ICTA-WEBINAR</span>
              </div>
            </div>
          )}
        </div>
      )}

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(validateAndSubmit)}
          className="space-y-3"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">姓名</FormLabel>
                <FormControl>
                  <Input placeholder="請輸入您的姓名" {...field} data-testid="input-embed-name" />
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
                <FormLabel className="text-xs">電話</FormLabel>
                <FormControl>
                  <Input type="tel" placeholder="請輸入您的電話號碼" {...field} data-testid="input-embed-phone" />
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
                <FormLabel className="text-xs">Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="your@email.com" {...field} data-testid="input-embed-email" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {customFields.map((cf) => (
            <div key={cf.id} className="space-y-1.5" data-testid={`field-embed-custom-${cf.id}`}>
              {cf.type !== "checkbox" && (
                <Label className="text-xs font-medium">
                  {cf.label}
                  {cf.required && <span className="text-destructive ml-1">*</span>}
                </Label>
              )}
              {cf.type === "text" && (
                <Input
                  value={customFieldValues[cf.id] || ""}
                  onChange={(e) => setCustomFieldValues((prev) => ({ ...prev, [cf.id]: e.target.value }))}
                  placeholder={cf.label}
                  data-testid={`input-embed-custom-${cf.id}`}
                />
              )}
              {cf.type === "textarea" && (
                <Textarea
                  value={customFieldValues[cf.id] || ""}
                  onChange={(e) => setCustomFieldValues((prev) => ({ ...prev, [cf.id]: e.target.value }))}
                  placeholder={cf.label}
                  rows={2}
                  data-testid={`input-embed-custom-${cf.id}`}
                />
              )}
              {cf.type === "select" && (
                <Select
                  value={customFieldValues[cf.id] || ""}
                  onValueChange={(v) => setCustomFieldValues((prev) => ({ ...prev, [cf.id]: v }))}
                >
                  <SelectTrigger data-testid={`select-embed-custom-${cf.id}`}>
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
                    data-testid={`checkbox-embed-custom-${cf.id}`}
                  />
                  <Label className="text-xs font-medium">
                    {cf.label}
                    {cf.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                </div>
              )}
              {customFieldErrors[cf.id] && (
                <p className="text-[10px] text-destructive" data-testid={`error-embed-custom-${cf.id}`}>此欄位為必填</p>
              )}
            </div>
          ))}

          {errorMessage && (
            <p className="text-xs text-destructive text-center" data-testid="text-embed-error">{errorMessage}</p>
          )}

          <Button
            type="submit"
            className="w-full"
            style={{ backgroundColor: accentColor }}
            disabled={registerMutation.isPending || (showSessionChoice && !selectedSession)}
            data-testid="button-embed-register"
          >
            {registerMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                報名中...
              </>
            ) : (
              "立即免費報名"
            )}
          </Button>
        </form>
      </Form>

      <p className="text-[10px] text-muted-foreground text-center mt-3 opacity-50">
        Powered by ICTA-WEBINAR
      </p>
    </div>
  );
}
