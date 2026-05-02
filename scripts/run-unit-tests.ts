import fs from "fs";
import path from "path";

type TestFn = () => void | Promise<void>;

function createExpect(received: any) {
  const toThrow = (msg?: string) => {
    throw new Error(msg ?? "Assertion failed");
  };
  const matchers = {
    toBe(expected: any) {
      if (received !== expected) toThrow(`Expected ${JSON.stringify(received)} to be ${JSON.stringify(expected)}`);
    },
    toEqual(expected: any) {
      const a = JSON.stringify(received);
      const b = JSON.stringify(expected);
      if (a !== b) toThrow(`Expected ${a} to equal ${b}`);
    },
    toBeLessThan(n: number) {
      if (!(received < n)) toThrow(`Expected ${received} to be less than ${n}`);
    },
    toBeGreaterThan(n: number) {
      if (!(received > n)) toThrow(`Expected ${received} to be greater than ${n}`);
    },
    toContain(item: any) {
      if (!Array.isArray(received) && typeof received !== "string") toThrow("toContain expects array or string");
      if (Array.isArray(received)) {
        if (!received.includes(item)) toThrow(`Expected array to contain ${JSON.stringify(item)}`);
      } else {
        if (!String(received).includes(String(item))) toThrow(`Expected string to contain ${item}`);
      }
    },
    toBeGreaterThanOrEqual(n: number) {
      if (!(received >= n)) toThrow(`Expected ${received} >= ${n}`);
    },
    toBeLessThanOrEqual(n: number) {
      if (!(received <= n)) toThrow(`Expected ${received} <= ${n}`);
    },
  } as any;

  const not = {} as any;
  for (const k of Object.keys(matchers)) {
    not[k] = (...args: any[]) => {
      try {
        (matchers as any)[k](...args);
      } catch (e) {
        return; // original would have thrown, so not.<matcher> passes
      }
      toThrow(`Negated matcher ${k} passed unexpectedly`);
    };
  }

  return { ...matchers, not };
}

const tests: { name: string; fn: TestFn }[] = [];

function describe(name: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.error(`Error in describe ${name}:`, e);
  }
}

function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

function expect(received: any) {
  return createExpect(received);
}

(global as any).describe = describe;
(global as any).test = test;
(global as any).expect = expect;

function findUnitFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...findUnitFiles(p));
    } else if (e.isFile() && e.name.endsWith(".unit.ts")) {
      out.push(p);
    }
  }
  return out;
}

async function run() {
  const root = path.resolve(__dirname, "..");
  const src = path.join(root, "src");
  const unitFiles = findUnitFiles(src);
  if (unitFiles.length === 0) {
    console.log("No unit test files found.");
    return;
  }
  console.log(`Found ${unitFiles.length} unit test file(s).`);
  for (const f of unitFiles) {
    console.log(`Loading ${path.relative(root, f)}...`);
    try {
      require(f);
    } catch (e) {
      console.error(`Error while loading ${f}:`, e);
    }
  }

  let passed = 0;
  const failed: { name: string; err: any }[] = [];
  for (const t of tests) {
    try {
      const res = t.fn();
      if (res && typeof (res as any).then === "function") await res;
      console.log(`✓ ${t.name}`);
      passed++;
    } catch (e) {
      console.error(`✗ ${t.name}`);
      console.error(e && e.stack ? e.stack : e);
      failed.push({ name: t.name, err: e });
    }
  }

  console.log(`\nTest summary: ${passed} passed, ${failed.length} failed, ${tests.length} total.`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("Test runner failed:", e);
  process.exitCode = 2;
});
