import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
try {
  const stars = [
    [747, "Casemiro"], [762, "Vinícius Júnior"], [1499, "Pedri"],
    [874, "Cristiano Ronaldo"], [297811, "Gavi"], [19318, "Vitinha"],
    [62820, "Lucas Paquetá"], [286, "Fabinho"],
    [162856, "Nico Williams"],
  ];
  for (const [id, label] of stars) {
    const r = (await sql`select team_code, name_en from public.players where api_football_id = ${id}`)[0];
    console.log(`${String(id).padStart(7)}  ${label.padEnd(22)}  → ${r ? `${r.team_code} ${r.name_en}` : "NOT IN DB"}`);
  }
} finally { await sql.end(); }
