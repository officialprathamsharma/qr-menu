/* Modal dialogs for the dashboard: confirmations and small forms, built on <dialog>. */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Open a dialog. body is trusted HTML. Resolves with the clicked button's value ('' when dismissed). */
export function openDialog({ title, body, buttons, wide = false, onOpen }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = `dlg${wide ? ' wide' : ''}`;
    d.innerHTML = `
      <form method="dialog" class="dlg-form">
        <h2 class="dlg-title">${esc(title)}</h2>
        <div class="dlg-body">${body}</div>
        <div class="dlg-foot">${buttons.map((b) => `<button class="btn ${b.kind || ''}" value="${esc(b.value)}" ${b.submit ? 'type="submit"' : 'type="submit" formnovalidate'}>${esc(b.label)}</button>`).join('')}</div>
      </form>`;
    document.body.append(d);
    let result = '';
    d.querySelector('form').addEventListener('submit', (e) => {
      result = e.submitter?.value || '';
      // A submit button runs the form's validation; a "cancel" button doesn't.
      const btn = buttons.find((b) => b.value === result);
      if (btn?.check && !btn.check(d)) e.preventDefault();
    });
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    d.showModal();
    onOpen?.(d);
  });
}

/** Yes/no confirmation. Resolves true only when the confirm button is clicked. */
export async function confirmDialog({ title, body, confirm = 'Continue', cancel = 'Cancel', danger = false }) {
  const v = await openDialog({
    title,
    body: `<p>${body}</p>`,
    buttons: [{ label: cancel, value: 'no', kind: 'ghost' }, { label: confirm, value: 'yes', kind: danger ? 'danger' : '', submit: true }],
  });
  return v === 'yes';
}
