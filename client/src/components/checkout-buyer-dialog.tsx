import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CheckoutBuyer = { name: string; email: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (buyer: CheckoutBuyer) => Promise<void>;
};

/** Collects the two checkout contact fields without collecting payment or marketing data. */
export function CheckoutBuyerDialog({ open, onOpenChange, onContinue }: Props) {
  const [buyer, setBuyer] = useState<CheckoutBuyer>({ name: "", email: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = buyer.name.trim();
    const email = buyer.email.trim();
    if (!name) return setError("請填寫姓名。");
    if (name.length > 200) return setError("姓名不可超過 200 個字元。");
    if (!email) return setError("請填寫電子信箱。");
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("請填寫有效的電子信箱。");
    setError("");
    setBusy(true);
    try {
      await onContinue({ name, email });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "無法建立付款，請稍後再試。");
    } finally {
      setBusy(false);
    }
  };

  return <Dialog open={open} onOpenChange={next => !busy && onOpenChange(next)}>
    <DialogContent data-testid="checkout-buyer-dialog" className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>填寫訂單聯絡資料</DialogTitle>
        <DialogDescription>商家會收到你的姓名與電子信箱，用於辨識此筆訂單與提供商品相關協助。</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div>
          <Label htmlFor="checkout-buyer-name">姓名</Label>
          <Input id="checkout-buyer-name" data-testid="checkout-buyer-name" className="mt-2" value={buyer.name} onChange={event => setBuyer(current => ({ ...current, name: event.target.value }))} autoComplete="name" maxLength={200} required aria-invalid={!!error && !buyer.name.trim()} />
        </div>
        <div>
          <Label htmlFor="checkout-buyer-email">電子信箱</Label>
          <Input id="checkout-buyer-email" data-testid="checkout-buyer-email" className="mt-2" type="email" value={buyer.email} onChange={event => setBuyer(current => ({ ...current, email: event.target.value }))} autoComplete="email" maxLength={320} required aria-invalid={!!error && !buyer.email.trim()} />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">不會在此頁收集密碼、卡片資料或自動同意行銷通知。</p>
        {error && <p className="text-sm text-destructive" role="alert" data-testid="checkout-buyer-error">{error}</p>}
        <Button className="w-full" type="submit" disabled={busy} data-testid="checkout-buyer-continue">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}前往安全付款
        </Button>
      </form>
    </DialogContent>
  </Dialog>;
}