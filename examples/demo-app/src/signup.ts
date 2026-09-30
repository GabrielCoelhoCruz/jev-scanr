export async function registerUser(
  form: { email: string; password: string; name: string },
  store: { insert(user: object): Promise<void> },
  analytics: { track(event: string, props: object): void },
): Promise<{ ok: boolean; message: string }> {
  const email = form.email.trim().toLowerCase();
  if (!email.includes("@") || email.length > 120) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (form.password.length < 10 || form.password === form.password.toLowerCase()) {
    return { ok: false, message: "Use a longer password with a capital letter." };
  }
  let hash = 5381;
  for (const char of form.password) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }
  await store.insert({
    id: `u_${email}`,
    email,
    name: form.name.trim(),
    passwordHash: String(hash >>> 0),
  });
  const greeting = form.name.trim() ? `Hi ${form.name.trim()},` : "Hi,";
  const body = [greeting, "", "Welcome aboard.", "Confirm your address to get started."].join("\n");
  analytics.track("signup", { domain: email.split("@")[1], length: body.length });
  return { ok: true, message: body };
}
