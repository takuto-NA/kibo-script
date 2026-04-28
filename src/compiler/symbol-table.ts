/**
 * compiler の ref 名から宣言済みシンボルへ名前解決するためのテーブル。
 * 重複宣言はバインダで検出し、ここでは Map に蓄えるだけとする。
 */

import type { AstRange } from "../ast/script-ast";
import type { DeviceAddress } from "../core/device-address";

export type RefSymbolEntry = {
  symbolName: string;
  deviceAddress: DeviceAddress;
  declarationRange: AstRange;
};

export class RefSymbolTable {
  private readonly symbolNameToEntry = new Map<string, RefSymbolEntry>();

  public tryRegister(entry: RefSymbolEntry): { ok: true } | { ok: false; existing: RefSymbolEntry } {
    const existingEntry = this.symbolNameToEntry.get(entry.symbolName);
    if (existingEntry !== undefined) {
      return { ok: false, existing: existingEntry };
    }
    this.symbolNameToEntry.set(entry.symbolName, entry);
    return { ok: true };
  }

  public lookup(symbolName: string): RefSymbolEntry | undefined {
    return this.symbolNameToEntry.get(symbolName);
  }

  public listAllSymbolEntries(): RefSymbolEntry[] {
    return [...this.symbolNameToEntry.values()];
  }
}
