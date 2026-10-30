export type FocusOwnershipToken = { origin: Element | null; revision: number; released: boolean };
export interface FocusOwnership {
  capture(): FocusOwnershipToken;
  focus(token: FocusOwnershipToken | null, target: HTMLElement | null): boolean;
  dispose(): void;
}
export function createFocusOwnership(document: Document): FocusOwnership;
export function createFocusOperationSlot(): {
  begin(token: FocusOwnershipToken | null): { token: FocusOwnershipToken | null };
  current(): FocusOwnershipToken | null;
  end(operation: { token: FocusOwnershipToken | null }): void;
};
