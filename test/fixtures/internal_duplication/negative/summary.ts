export function describe(user: { name: string; age: number }) {
  const label = user.name.trim().toUpperCase();
  const adult = user.age >= 18;
  const bucket = Math.floor(user.age / 10) * 10;
  return { label, adult, bucket };
}
