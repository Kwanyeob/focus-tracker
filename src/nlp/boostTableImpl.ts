import type { BoostTable } from "./boostTable";

const APP_BOOST = 0.15;

export class BoostTableImpl implements BoostTable {
  getAppBoost(appName: string, appHint: string | null): number {
    if (!appHint) return 0;
    const app  = appName.toLowerCase();
    const hint = appHint.toLowerCase();
    return app.includes(hint) || hint.includes(app) ? APP_BOOST : 0;
  }
}
