/**
 * Opening a conflict copy in the editor must not bind it to the CRDT.
 *
 * resolveBindingTarget() used to bind to the existing Y.Text for the path, or
 * call ensureFile() when there was none. For a new conflict copy that admits
 * it to the CRDT; for a legacy copy already in the CRDT it lets remote edits
 * reach the file through the editor, bypassing the disk-writeback gate.
 */
import { type MarkdownView, type TFile, type Workspace, type WorkspaceLeaf } from "obsidian";
import * as Y from "yjs";
import { EditorBindingManager } from "../../src/sync/editorBinding";
import type { VaultSync } from "../../src/sync/vaultSync";
import { partialOf } from "../mocks/productFixture.ts";
import { suite } from "../harness.ts";

const s = suite("conflict-artifact-editor-binding");

const LEGACY_ARTIFACT = "Notes/Plan (YAOS conflict from phone 2026-04-01T10-00-00Z).md";
const NEW_ARTIFACT = "Notes/Plan (YAOS conflict - disk from laptop 2026-05-02T08-30-00Z).md";
const UPPERCASE_ARTIFACT = "Notes/Plan (YAOS conflict from phone 2026-04-01T10-00-00Z).MD";
const ORDINARY = "Notes/Plan.md";

interface Harness {
	manager: EditorBindingManager;
	ensureFileCalls: string[];
	traces: string[];
	legacyText: Y.Text;
}

function makeHarness(): Harness {
	const doc = new Y.Doc();
	const legacyText = doc.getText("legacy");
	legacyText.insert(0, "remote content");
	const ordinaryText = doc.getText("ordinary");
	const ensureFileCalls: string[] = [];
	const traces: string[] = [];

	const texts = new Map<string, Y.Text>([[LEGACY_ARTIFACT, legacyText]]);
	const vaultSync = partialOf<VaultSync>({
		getTextForPath: (path: string) => texts.get(path) ?? null,
		getFileId: () => "file-id",
		getFileIdForText: () => "file-id",
		isPendingRenameTarget: () => false,
		isMarkdownTombstoned: () => false,
		ensureFile: (path: string) => {
			ensureFileCalls.push(path);
			texts.set(path, ordinaryText);
			return ordinaryText;
		},
	});
	const manager = new EditorBindingManager(
		vaultSync,
		partialOf<Workspace>({}),
		false,
		(_category, event) => {
			traces.push(event);
		},
	);
	return { manager, ensureFileCalls, traces, legacyText };
}

function makeView(path: string, content = "local content"): MarkdownView {
	return partialOf<MarkdownView>({
		file: partialOf<TFile>({ path }),
		leaf: partialOf<WorkspaceLeaf>({ id: `leaf:${path}` }),
		editor: partialOf<MarkdownView["editor"]>({ getValue: () => content }),
	});
}

s.section("Test 1: legacy conflict copy already in the CRDT is not bound");
{
	const h = makeHarness();
	const target = h.manager["resolveBindingTarget"](makeView(LEGACY_ARTIFACT), "device", "bind");
	s.check(target === null, "no binding target for a legacy conflict copy");
	s.check(h.ensureFileCalls.length === 0, "ensureFile is not called");
	s.check(
		h.traces.includes("binding-blocked-conflict-artifact"),
		"blocked binding is traced",
	);
}

s.section("Test 2: new conflict copy is not admitted to the CRDT");
{
	const h = makeHarness();
	for (const path of [NEW_ARTIFACT, UPPERCASE_ARTIFACT]) {
		const target = h.manager["resolveBindingTarget"](makeView(path), "device", "bind");
		s.check(target === null, `no binding target for ${path}`);
	}
	s.check(h.ensureFileCalls.length === 0, "ensureFile is never called for conflict copies");
}

s.section("Test 3: heal() treats a conflict copy as intentionally unbound");
{
	const h = makeHarness();
	const healed = h.manager.heal(makeView(LEGACY_ARTIFACT, "edited locally"), "device", "test");
	s.check(healed, "heal reports success instead of a failure to retry");
	s.check(
		h.legacyText.toJSON() === "remote content",
		"heal does not push editor content into the legacy CRDT entry",
	);
}

s.section("Test 4: rebind() does not bind a conflict copy");
{
	const h = makeHarness();
	let bindCalls = 0;
	const originalBind = h.manager.bind.bind(h.manager);
	h.manager.bind = (view, deviceName) => {
		bindCalls += 1;
		originalBind(view, deviceName);
	};
	h.manager.rebind(makeView(LEGACY_ARTIFACT), "device", "test");
	s.check(bindCalls === 0, "rebind short-circuits before bind");
}

s.section("Test 5: ordinary notes still bind normally");
{
	const h = makeHarness();
	const target = h.manager["resolveBindingTarget"](makeView(ORDINARY), "device", "bind");
	s.check(target !== null, "ordinary note gets a binding target");
	s.check(
		h.ensureFileCalls.length === 1 && h.ensureFileCalls[0] === ORDINARY,
		"ordinary note is admitted via ensureFile",
	);
	s.check(
		!h.traces.includes("binding-blocked-conflict-artifact"),
		"ordinary note is not reported as a conflict artifact",
	);
}

await s.done();
