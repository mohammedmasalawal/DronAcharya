import { DEMO_PREFIX, countSessions, importDemoData, resetDemoData } from '../store';

let seeding: Promise<boolean> | null = null;

async function loadDemoJson(): Promise<unknown> {
  const module = await import('../../data/demo/demo-data.json');
  return module.default;
}

export function ensureDemoSeeded(): Promise<boolean> {
  if (!seeding) {
    seeding = (async () => {
      if ((await countSessions()) > 0) return false;
      await importDemoData(await loadDemoJson());
      return true;
    })().catch((error: unknown) => {
      seeding = null;
      throw error;
    });
  }
  return seeding;
}

export async function reimportDemo(): Promise<void> {
  await resetDemoData();
  await importDemoData(await loadDemoJson());
}

export function isDemoId(id: string): boolean {
  return id.startsWith(DEMO_PREFIX);
}
