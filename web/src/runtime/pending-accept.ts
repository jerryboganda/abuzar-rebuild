// PowerBuilder: AcceptText called (directly or through a function) from a DataWindow's own ItemChanged event does not validate the
// pending edit again; it puts the new value into the row and returns 1.  Scripts rely on it: w_sale.wf_setcustomerinfo calls
// id_master.AcceptText() from dw_detail.ItemChanged and then reads GetItemNumber(row, "custcode") to load the chosen customer.
// The edit path records here how to apply the value while ItemChanged runs; the runtime's AcceptText uses it.

const pending = new WeakMap<object, () => void>()

/** Runs `event` (the ItemChanged dispatch) with `apply` available to a nested AcceptText of `control`. */
export async function withPendingAccept<T>(control: object, apply: () => void, event: () => Promise<T>): Promise<T> {
  const previous = pending.get(control)
  pending.set(control, apply)
  try { return await event() } finally {
    if (previous) pending.set(control, previous)
    else pending.delete(control)
  }
}

/** Applies the value pending in `control`'s ItemChanged, if any (once). */
export function applyPendingAccept(control: object): void {
  const apply = pending.get(control)
  if (!apply) return
  pending.delete(control)
  apply()
}
