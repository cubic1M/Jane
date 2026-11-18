import type { Connector } from "../types";

// Akoya's Tax API (read connectors, 11-18; docs.akoya.com/reference, read 2026-11-17; Tax is in
// beta): the person's 1099s and 1098s as figures, from the banks and brokers that send them, so
// Jane's tax documents check (spec step 166) collects them on its own and ticks off the ones that
// agree with the accounts. Read only; never the form itself (./normalize.ts).
//
// Two registrations. The real one reads with the person's Akoya link from the vault (their
// institution and refresh token, saved when they finish Akoya's consent; that sign-in step isn't
// built: it needs a route of its own). It reaches nobody until REAL_CONNECTORS.akoya_tax, which
// needs Akoya's security review, its agreement and each provider's approval. The sandbox twin writes
// Akoya's form shape from the sample person's own figures and reads it back (./partner.ts).
// Neither has a webhook: Akoya's notifications aren't needed for a once-a-day collector.

export const akoyaTax: Connector = {
  id: "akoya_tax",
  name: "Your tax forms from your bank and broker, through Akoya",
  category: "tax",
  capabilities: ["read"],
  scopes: ["read_accounts"],
  sandbox: false,
  movesMoney: false,
};

export const sandboxAkoyaTax: Connector = {
  id: "sandbox_akoya_tax",
  name: "Your tax forms from your bank and broker, through Akoya (sandbox)",
  category: "tax",
  capabilities: ["read"],
  scopes: ["read_accounts"],
  sandbox: true,
  movesMoney: false,
};
