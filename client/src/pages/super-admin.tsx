import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Users, Crown, ArrowLeft, Calendar, Shield, ShieldOff, Loader2, Search
} from "lucide-react";
import { useAdminLang, type LangAdmin } from "@/hooks/use-lang";

type AdminUser = {
  id: string;
  username: string;
  email: string;
  companyName: string;
  subscriptionPlan: string;
  planExpiresAt: string | null;
  maxWebinars: number;
  isActive: boolean;
  isSuperAdmin: boolean;
  createdAt: string;
  webinarCount: number;
  isExpired: boolean;
};

const t: Record<LangAdmin, Record<string, string>> = {
  "zh-TW": {
    title: "超級管理員",
    subtitle: "管理所有使用者與訂閱方案",
    backToDashboard: "返回後台",
    totalUsers: "總使用者數",
    activeUsers: "啟用中",
    expiredUsers: "已過期",
    monthlyUsers: "月租方案",
    searchPlaceholder: "搜尋使用者名稱或 Email...",
    username: "帳號",
    email: "Email",
    company: "公司名稱",
    plan: "方案",
    webinars: "直播間",
    expires: "到期日",
    status: "狀態",
    actions: "操作",
    planFree: "免費方案",
    planMonthly: "月租方案 ($49/月)",
    planEnterprise: "企業方案",
    active: "啟用",
    inactive: "停用",
    expired: "已過期",
    superAdmin: "超級管理員",
    save: "儲存",
    saving: "儲存中...",
    maxWebinars: "直播間上限",
    expiresAt: "到期日期",
    noExpiry: "無到期日",
    editUser: "編輯使用者",
    cancel: "取消",
    updated: "已更新",
    updateSuccess: "使用者資料已更新",
    noUsers: "尚無使用者",
    enableUser: "啟用",
    disableUser: "停用",
    free: "免費",
    monthly: "月租",
    enterprise: "企業",
    of: "/",
    rooms: "間",
  },
  "zh-CN": {
    title: "超级管理员",
    subtitle: "管理所有用户与订阅方案",
    backToDashboard: "返回后台",
    totalUsers: "总用户数",
    activeUsers: "启用中",
    expiredUsers: "已过期",
    monthlyUsers: "月租方案",
    searchPlaceholder: "搜索用户名称或 Email...",
    username: "账号",
    email: "Email",
    company: "公司名称",
    plan: "方案",
    webinars: "直播间",
    expires: "到期日",
    status: "状态",
    actions: "操作",
    planFree: "免费方案",
    planMonthly: "月租方案 ($49/月)",
    planEnterprise: "企业方案",
    active: "启用",
    inactive: "停用",
    expired: "已过期",
    superAdmin: "超级管理员",
    save: "保存",
    saving: "保存中...",
    maxWebinars: "直播间上限",
    expiresAt: "到期日期",
    noExpiry: "无到期日",
    editUser: "编辑用户",
    cancel: "取消",
    updated: "已更新",
    updateSuccess: "用户资料已更新",
    noUsers: "尚无用户",
    enableUser: "启用",
    disableUser: "停用",
    free: "免费",
    monthly: "月租",
    enterprise: "企业",
    of: "/",
    rooms: "间",
  },
};

function getPlanBadge(plan: string, s: Record<string, string>) {
  switch (plan) {
    case "monthly":
      return <Badge variant="default" data-testid="badge-plan-monthly">{s.monthly}</Badge>;
    case "enterprise":
      return <Badge variant="secondary" data-testid="badge-plan-enterprise">{s.enterprise}</Badge>;
    default:
      return <Badge variant="outline" data-testid="badge-plan-free">{s.free}</Badge>;
  }
}

function EditUserDialog({ user, s, onClose }: { user: AdminUser; s: Record<string, string>; onClose: () => void }) {
  const { toast } = useToast();
  const [plan, setPlan] = useState(user.subscriptionPlan);
  const [maxWebinars, setMaxWebinars] = useState(user.maxWebinars);
  const [expiresAt, setExpiresAt] = useState(
    user.planExpiresAt ? new Date(user.planExpiresAt).toISOString().split("T")[0] : ""
  );

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/super-admin/users/${user.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/users"] });
      toast({ title: s.updated, description: s.updateSuccess });
      onClose();
    },
  });

  const handlePlanChange = (newPlan: string) => {
    setPlan(newPlan);
    if (newPlan === "monthly") {
      setMaxWebinars(3);
    } else if (newPlan === "enterprise") {
      setMaxWebinars(999);
    } else {
      setMaxWebinars(1);
    }
  };

  return (
    <Card className="border-2 border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {s.editUser}: {user.username}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{s.plan}</label>
            <Select value={plan} onValueChange={handlePlanChange}>
              <SelectTrigger data-testid="select-plan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">{s.planFree}</SelectItem>
                <SelectItem value="monthly">{s.planMonthly}</SelectItem>
                <SelectItem value="enterprise">{s.planEnterprise}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{s.maxWebinars}</label>
            <Input
              type="number"
              min={0}
              value={maxWebinars}
              onChange={(e) => setMaxWebinars(parseInt(e.target.value) || 0)}
              data-testid="input-max-webinars"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{s.expiresAt}</label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              data-testid="input-expires-at"
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-edit">
            {s.cancel}
          </Button>
          <Button
            onClick={() =>
              updateMutation.mutate({
                subscriptionPlan: plan,
                maxWebinars,
                planExpiresAt: expiresAt || null,
              })
            }
            disabled={updateMutation.isPending}
            data-testid="button-save-user"
          >
            {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {updateMutation.isPending ? s.saving : s.save}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SuperAdmin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { lang, setLang } = useAdminLang();
  const s = t[lang];
  const [searchQuery, setSearchQuery] = useState("");
  const [editingUser, setEditingUser] = useState<string | null>(null);

  const { data: me } = useQuery<{ id: string; isSuperAdmin: boolean }>({
    queryKey: ["/api/admin/me"],
  });

  const { data: users = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/super-admin/users"],
    enabled: !!me?.isSuperAdmin,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/super-admin/users/${userId}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/users"] });
    },
  });

  if (!me?.isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">403 Forbidden</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.companyName || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalActive = users.filter((u) => u.isActive && !u.isExpired).length;
  const totalExpired = users.filter((u) => u.isExpired).length;
  const totalMonthly = users.filter((u) => u.subscriptionPlan === "monthly").length;

  return (
    <div className="admin-shell super-admin">
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Crown className="h-6 w-6 text-amber-500" />
            <h1 className="text-xl font-bold tracking-tight">{s.title}</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const next = lang === "zh-TW" ? "zh-CN" : "zh-TW";
                setLang(next);
              }}
              data-testid="button-lang-toggle"
            >
              {lang === "zh-TW" ? "簡" : "繁"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/dashboard")} data-testid="button-back-dashboard">
              <ArrowLeft className="h-4 w-4 mr-1" />
              {s.backToDashboard}
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Users className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-users">{users.length}</p>
                <p className="text-xs text-muted-foreground">{s.totalUsers}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Shield className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-active-users">{totalActive}</p>
                <p className="text-xs text-muted-foreground">{s.activeUsers}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Calendar className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-expired-users">{totalExpired}</p>
                <p className="text-xs text-muted-foreground">{s.expiredUsers}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Crown className="h-8 w-8 text-amber-500" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-monthly-users">{totalMonthly}</p>
                <p className="text-xs text-muted-foreground">{s.monthlyUsers}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={s.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-users"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              {s.noUsers}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredUsers.map((user) => (
              <div key={user.id}>
                <Card className={!user.isActive ? "opacity-60" : ""}>
                  <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold" data-testid={`text-username-${user.id}`}>{user.username}</span>
                          {user.isSuperAdmin && (
                            <Badge variant="secondary" data-testid={`badge-super-admin-${user.id}`}>
                              <Crown className="h-3 w-3 mr-1" />
                              {s.superAdmin}
                            </Badge>
                          )}
                          {getPlanBadge(user.subscriptionPlan, s)}
                          {user.isExpired && (
                            <Badge variant="destructive" data-testid={`badge-expired-${user.id}`}>{s.expired}</Badge>
                          )}
                          {!user.isActive && (
                            <Badge variant="destructive" data-testid={`badge-inactive-${user.id}`}>{s.inactive}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                          <span data-testid={`text-email-${user.id}`}>{user.email}</span>
                          {user.companyName && <span>{user.companyName}</span>}
                          <span data-testid={`text-webinar-count-${user.id}`}>
                            {user.webinarCount}{s.of}{user.maxWebinars} {s.rooms}
                          </span>
                          {user.planExpiresAt && (
                            <span data-testid={`text-expires-${user.id}`}>
                              {s.expires}: {new Date(user.planExpiresAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!user.isSuperAdmin && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditingUser(editingUser === user.id ? null : user.id)}
                              data-testid={`button-edit-${user.id}`}
                            >
                              {s.editUser}
                            </Button>
                            <Button
                              variant={user.isActive ? "destructive" : "default"}
                              size="sm"
                              onClick={() =>
                                toggleActiveMutation.mutate({
                                  userId: user.id,
                                  isActive: !user.isActive,
                                })
                              }
                              disabled={toggleActiveMutation.isPending}
                              data-testid={`button-toggle-active-${user.id}`}
                            >
                              {user.isActive ? <ShieldOff className="h-3.5 w-3.5 mr-1" /> : <Shield className="h-3.5 w-3.5 mr-1" />}
                              {user.isActive ? s.disableUser : s.enableUser}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {editingUser === user.id && (
                  <div className="mt-2">
                    <EditUserDialog user={user} s={s} onClose={() => setEditingUser(null)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
