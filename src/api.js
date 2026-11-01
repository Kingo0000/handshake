export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let sdkPromise;

// Loads the PayPal JS SDK once, set up for authorize-then-capture.
export function loadPayPalSdk(clientId, currency) {
  sdkPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const params = new URLSearchParams({ 'client-id': clientId, intent: 'authorize', currency, components: 'buttons' });
    script.src = `https://www.paypal.com/sdk/js?${params}`;
    script.onload = () => resolve(window.paypal);
    script.onerror = () => {
      sdkPromise = undefined;
      reject(new Error('Could not load PayPal'));
    };
    document.head.append(script);
  });
  return sdkPromise;
}
