import assert from "node:assert/strict";
import test from "node:test";
import {
  createCheckMacValue,
  decryptEcpayCredential,
  encryptEcpayCredential,
  merchantTradeDate,
  validateEcpayCallback,
  verifyCheckMacValue,
} from "./ecpay";

const key = "pwFHCqoQZGmho4w6";
const iv = "EkRm7iFT261dpevs";

test("ECPay official SHA256 CheckMacValue vectors", () => {
  const vectors = [
    [{ MerchantID: "3002607", MerchantTradeNo: "Test1234567890", MerchantTradeDate: "2025/01/01 12:00:00", PaymentType: "aio", TotalAmount: "100", TradeDesc: "測試", ItemName: "測試商品", ReturnURL: "https://example.com/notify", ChoosePayment: "ALL", EncryptType: "1" }, "291CBA324D31FB5A4BBBFDF2CFE5D32598524753AFD4959C3BF590C5B2F57FB2"],
    [{ MerchantID: "3002607", ItemName: "Tom's Shop", TotalAmount: "100" }, "CF0A3D4901D99459D8641516EC57210700E8A5C9AB26B1D021301E9CB93EF78D"],
    [{ MerchantID: "3002607", ItemName: "Test~Product", TotalAmount: "200" }, "CEEAE01D2F9A8E74D4AC0DCE7735B046D73F35A5EC99558A31A2EE03159DA1C9"],
    [{ MerchantID: "3002607", ItemName: "My Test Product", TotalAmount: "300" }, "7712A5E6EDC3B57086063C88568084C66CE882A21D40E74DE5ACA3B478C6F316"],
    [{ MerchantID: "3002607", MerchantTradeNo: "Test1234567890", RtnCode: "1", RtnMsg: "Succeeded", TradeNo: "2301011234567890", TradeAmt: "100", PaymentDate: "2025/01/01 12:05:00", PaymentType: "Credit_CreditCard", TradeDate: "2025/01/01 12:00:00", SimulatePaid: "0" }, "2AB536D86AFF8E1086744D59175040A32538C96B1C28C4135B551BD728E913B8"],
  ] as const;
  for (const [fields, expected] of vectors) {
    assert.equal(createCheckMacValue(fields, key, iv), expected);
  }
});

test("callback validation rejects tampered MAC, merchant, and amount", () => {
  const callback = { MerchantID: "3002607", MerchantTradeNo: "Test1234567890", RtnCode: "1", RtnMsg: "Succeeded", TradeNo: "2301011234567890", TradeAmt: "100", PaymentDate: "2025/01/01 12:05:00", PaymentType: "Credit_CreditCard", TradeDate: "2025/01/01 12:00:00", SimulatePaid: "0" };
  const CheckMacValue = createCheckMacValue(callback, key, iv);
  const expected = { merchantId: "3002607", merchantTradeNo: "Test1234567890", amount: 100, hashKey: key, hashIv: iv };
  assert.equal(validateEcpayCallback({ ...callback, CheckMacValue }, expected), true);
  assert.equal(validateEcpayCallback({ ...callback, MerchantID: "3002608", CheckMacValue }, expected), false);
  assert.equal(validateEcpayCallback({ ...callback, TradeAmt: "101", CheckMacValue }, expected), false);
  assert.equal(validateEcpayCallback({ ...callback, CheckMacValue: `${CheckMacValue.slice(0, -1)}0` }, expected), false);
  const simulated = { ...callback, SimulatePaid: "1" };
  const simulatedMac = createCheckMacValue(simulated, key, iv);
  assert.equal(validateEcpayCallback({ ...simulated, CheckMacValue: simulatedMac }, expected), false);
  assert.equal(validateEcpayCallback(
    { ...simulated, CheckMacValue: simulatedMac },
    { ...expected, allowSimulated: true },
  ), true);
});

test("MerchantTradeDate uses a zero-padded 24-hour Asia/Taipei clock at midnight", () => {
  assert.equal(merchantTradeDate(new Date("2024-12-31T16:00:00.000Z")), "2025/01/01 00:00:00");
});

test("ECPay credentials use authenticated versioned encryption", () => {
  const secret = "test-session-secret-with-enough-entropy";
  const encrypted = encryptEcpayCredential("sensitive-value", secret);
  assert.match(encrypted, /^v1\./);
  assert.equal(encrypted.includes("sensitive-value"), false);
  assert.equal(decryptEcpayCredential(encrypted, secret), "sensitive-value");
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => decryptEcpayCredential(tampered, secret));
});