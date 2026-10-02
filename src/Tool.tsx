// Semestr: paste a syllabus, get every deadline in your calendar with study sessions planned backwards from each one.
import { useState } from "react";
import { downloadIcs, localDate } from "./lib/ics";
import { uid, useStored } from "./lib/store";
import { addDays, prettyDate, todayISO } from "./lib/time";
import { Section, Stat, Stats } from "./ui/kit";

const T = "semestr";
type Item = { id: string; course: string; title: string; date: string; kind: string; weight: number };
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, janv: 1, fev: 2, fevr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, octo: 10 };
const KINDS: [RegExp, string][] = [[/midterm|partiel/i, "Midterm"], [/present/i, "Presentation"], [/project|projet/i, "Project"], [/essay|paper|report|rapport|dissertation/i, "Essay"], [/quiz|test/i, "Quiz"], [/lab|tp/i, "Lab"], [/homework|assignment|problem set|devoir|pset/i, "Assignment"], [/final|exam/i, "Exam"]];
const PREP: Record<string, { days: number; hours: number }> = { Exam: { days: 10, hours: 12 }, Midterm: { days: 7, hours: 8 }, Quiz: { days: 3, hours: 2 }, Project: { days: 14, hours: 15 }, Essay: { days: 10, hours: 10 }, Presentation: { days: 5, hours: 4 }, Lab: { days: 3, hours: 3 }, Assignment: { days: 4, hours: 4 }, Other: { days: 3, hours: 2 } };
const SAMPLE = `ECON 201: Principles of Macroeconomics, Fall 2026
Week 1 (Sep 14): Introduction
Problem set 1 due Sept 25 (5%)
Problem set 2 due October 9 (5%)
Quiz 1 in class on 16 Oct (10%)
Midterm exam: Oct 30, 2026 (25%)
Group project proposal due 13/11/2026 (5%)
Problem set 3 due Nov 20 (5%)
Final group project presentation Dec 4 (15%)
Final exam: December 17 (30%)`;

function parse(text: string, course: string, year: number): Item[] {
  const out: Item[] = [];
  for (const line of text.split("\n")) {
    let m: RegExpMatchArray | null, date = "";
    const low = line.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if ((m = low.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    else if ((m = low.match(/(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/))) date = `${m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    else {
      // Check every "Month 14" and "14 Month" pair on the line, since earlier pairs are often not dates ("set 1 due Sept 25").
      const mon = (w: string) => MONTHS[w.slice(0, 4)] || MONTHS[w.slice(0, 3)];
      for (const x of low.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/g)) if (mon(x[1])) { date = `${x[3] ?? year}-${String(mon(x[1])).padStart(2, "0")}-${x[2].padStart(2, "0")}`; break; }
      if (!date) for (const x of low.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:\s+(\d{4}))?/g)) if (mon(x[2])) { date = `${x[3] ?? year}-${String(mon(x[2])).padStart(2, "0")}-${x[1].padStart(2, "0")}`; break; }
    }
    if (!date || isNaN(new Date(date).getTime())) continue;
    const kind = KINDS.find(([rx]) => rx.test(line))?.[1];
    if (!kind) continue; // lines with a date but no deliverable, like "Week 1: Introduction"
    const weight = parseFloat(line.match(/(\d{1,3})\s*%/)?.[1] ?? "0");
    const title = line.replace(/\(?\d{1,3}\s*%\)?/, "").replace(/[:\-–]\s*$/, "").trim();
    out.push({ id: uid(), course, title, date, kind, weight });
  }
  return out;
}

export default function Semestr() {
  const [items, setItems] = useStored<Item[]>(T, "items", parse(SAMPLE, "ECON 201", 2026));
  const [text, setText] = useState("");
  const [course, setCourse] = useState("");
  const [time, setTime] = useStored(T, "time", "17:00");
  const [perDay, setPerDay] = useStored(T, "perDay", 2);
  const year = new Date().getFullYear();
  const upcoming = items.filter(i => i.date >= todayISO()).sort((a, b) => a.date.localeCompare(b.date));
  // Study blocks: spread the prep hours over the days before each deadline, never more than `perDay` hours a day.
  const blocks = upcoming.flatMap(i => { const p = PREP[i.kind] ?? PREP.Other; const n = Math.ceil(p.hours / perDay); return Array.from({ length: n }, (_, k) => ({ item: i, date: addDays(i.date, -Math.max(1, Math.round(((k + 1) * p.days) / n))), hours: Math.min(perDay, p.hours - k * perDay) })).filter(b => b.date >= todayISO()); });
  const busiest = Object.entries(blocks.reduce((a, b) => { const w = b.date.slice(0, 8) + String(Math.ceil(+b.date.slice(8) / 7)); a[w] = (a[w] ?? 0) + b.hours; return a; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1])[0];
  const exportIcs = () => downloadIcs("semester.ics", [
    ...upcoming.map(i => ({ title: `${i.course}: ${i.title}`, start: localDate(i.date), allDay: true, alarmMinutes: 24 * 60 })),
    ...blocks.map(b => { const s = localDate(b.date, time); return { title: `Study: ${b.item.course} ${b.item.kind.toLowerCase()}`, start: s, end: new Date(s.getTime() + b.hours * 3600000), description: `For "${b.item.title}" on ${b.item.date}` }; }),
  ], "Semester");

  return (
    <div className="stack">
      <Section title="Your semester" aside={<button className="btn small primary" onClick={exportIcs} disabled={!upcoming.length}>Add everything to my calendar</button>}>
        <Stats><Stat value={upcoming.length} label="Deadlines ahead" /><Stat value={upcoming[0] ? prettyDate(upcoming[0].date) : "–"} label="Next deadline" tone="warn" /><Stat value={`${blocks.reduce((a, b) => a + b.hours, 0)} h`} label="Study planned" /><Stat value={[...new Set(items.map(i => i.course))].length} label="Courses" /></Stats>
        {busiest && busiest[1] > 10 && <p className="pill warn" style={{ marginTop: 10 }}>One week has {busiest[1]} hours of study planned. Start earlier on something due then.</p>}
      </Section>
      <div className="grid2">
        <Section title="Add a syllabus">
          <div className="stack" style={{ gap: 10 }}>
            <label className="field"><span>Course name</span><input id="se-c" className="input" value={course} onChange={e => setCourse(e.target.value)} placeholder="BIO 110" /></label>
            <label className="field"><span>Paste the syllabus or schedule (a PDF's text works: select all, copy, paste)</span><textarea id="se-t" className="input" rows={7} value={text} onChange={e => setText(e.target.value)} /></label>
            <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={!text.trim()} onClick={() => { const found = parse(text, course || "Course", year); setItems([...items, ...found]); setText(""); }}>Find the deadlines</button>
            <p className="note">Recognises dates like 14 Oct, October 14, 14/10/2026 and 2026-10-14, in English or French. Check the list and fix anything it missed.</p>
          </div>
        </Section>
        <Section title="Study settings">
          <div className="row"><label className="field"><span>Study sessions start at</span><input id="se-time" type="time" className="input" value={time} onChange={e => setTime(e.target.value)} /></label><label className="field"><span>Max hours per session</span><select id="se-pd" className="input" value={perDay} onChange={e => setPerDay(+e.target.value)}>{[1, 1.5, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div>
          <table className="t" style={{ marginTop: 12 }}><thead><tr><th>Type</th><th className="r">Start</th><th className="r">Hours</th></tr></thead><tbody>{Object.entries(PREP).map(([k, p]) => <tr key={k}><td>{k}</td><td className="r">{p.days} days before</td><td className="r">{p.hours}</td></tr>)}</tbody></table>
        </Section>
      </div>
      <Section title="Deadlines">
        <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>Course</th><th>What</th><th>Type</th><th className="r">Weight</th><th /></tr></thead>
          <tbody>{[...items].sort((a, b) => a.date.localeCompare(b.date)).map(i => (
            <tr key={i.id} style={{ opacity: i.date < todayISO() ? 0.45 : 1 }}>
              <td><input type="date" className="input" value={i.date} aria-label="Date" onChange={e => setItems(items.map(x => x.id === i.id ? { ...x, date: e.target.value } : x))} /></td>
              <td>{i.course}</td><td><input className="input" aria-label="Title" value={i.title} onChange={e => setItems(items.map(x => x.id === i.id ? { ...x, title: e.target.value } : x))} /></td>
              <td><select className="input" aria-label="Type" value={i.kind} onChange={e => setItems(items.map(x => x.id === i.id ? { ...x, kind: e.target.value } : x))}>{Object.keys(PREP).map(k => <option key={k}>{k}</option>)}</select></td>
              <td className="r">{i.weight ? `${i.weight}%` : ""}</td><td><button className="btn ghost small danger" onClick={() => setItems(items.filter(x => x.id !== i.id))}>×</button></td></tr>
          ))}</tbody></table></div>
        <button className="btn small" style={{ marginTop: 10 }} onClick={() => setItems([...items, { id: uid(), course: course || "Course", title: "New deadline", date: addDays(todayISO(), 14), kind: "Assignment", weight: 0 }])}>Add one by hand</button>
      </Section>
      <Section title="Next two weeks">
        {blocks.filter(b => b.date <= addDays(todayISO(), 14)).sort((a, b) => a.date.localeCompare(b.date)).map((b, i) => <p key={i}><strong>{prettyDate(b.date)}</strong> {time}, {b.hours} h: {b.item.course} {b.item.kind.toLowerCase()} <span className="note">(due {prettyDate(b.item.date)})</span></p>)}
        {!blocks.some(b => b.date <= addDays(todayISO(), 14)) && <p className="empty-note">No study sessions in the next two weeks.</p>}
      </Section>
    </div>
  );
}
