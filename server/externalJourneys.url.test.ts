import assert from "node:assert/strict";
import test from "node:test";
import dns from "node:dns/promises";
import { assertExternalJourneyUrl } from "./externalJourneys";

const privateIPv4 = [
  "0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254",
  "172.16.0.1", "172.31.255.255", "192.168.1.1",
  "100.64.0.1", "100.127.255.255", "224.0.0.1", "255.255.255.255",
];

function mappedForms(ip: string) {
  const [a, b, c, d] = ip.split(".").map(Number);
  const high = ((a << 8) | b).toString(16);
  const low = ((c << 8) | d).toString(16);
  return [
    `::ffff:${ip}`,
    `::ffff:${high}:${low}`,
    `0:0:0:0:0:FFFF:${high.padStart(4, "0")}:${low.padStart(4, "0")}`,
  ];
}

test("external journey URLs reject private IPv4-mapped IPv6 literals before DNS", async (t) => {
  const lookup = t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  for (const ip of privateIPv4) {
    for (const host of mappedForms(ip)) {
      await assert.rejects(assertExternalJourneyUrl(`https://[${host}]/register`), /External URL is unsafe/, host);
    }
  }
  assert.equal(lookup.mock.callCount(), 0);
});

test("external journey DNS validation rejects every mapped private address, even in mixed answers", async (t) => {
  let address = "";
  t.mock.method(dns, "lookup", async () => [
    { address: "93.184.216.34", family: 4 },
    { address, family: 6 },
  ]);
  for (const ip of privateIPv4) {
    for (const host of mappedForms(ip)) {
      address = host;
      await assert.rejects(
        assertExternalJourneyUrl("https://journey.example.test/register"),
        /External URL cannot target a private network/,
        host,
      );
    }
  }
});

test("external journey DNS validation preserves public IPv4, IPv6, and mapped IPv4", async (t) => {
  let address = "";
  t.mock.method(dns, "lookup", async () => [{ address, family: address.includes(":") ? 6 : 4 }]);
  for (const host of ["93.184.216.34", "2606:4700:4700::1111", ...mappedForms("8.8.8.8")]) {
    address = host;
    const url = await assertExternalJourneyUrl("https://journey.example.test/register");
    assert.equal(url.href, "https://journey.example.test/register");
  }
});
