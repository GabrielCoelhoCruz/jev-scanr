export async function syncProfile(id: string, db: { save(row: unknown): Promise<void> }) {
  const response = await fetch(`https://api.example.com/users/${id}`);
  const raw = await response.json();
  const profile = {
    id: raw.id,
    displayName: `${raw.first_name} ${raw.last_name}`.trim(),
    joined: new Date(raw.created_at).toISOString(),
  };
  await db.save(profile);
  document.title = profile.displayName;
  const badge = document.createElement("span");
  badge.textContent = profile.displayName;
  document.body.appendChild(badge);
  return profile;
}
