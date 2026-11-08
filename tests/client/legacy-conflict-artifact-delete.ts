/**
 * Deleting a legacy conflict copy locally must retire its CRDT entry.
 *
 * Conflict copies are local-only, so the vault delete handler ignored them.
 * Copies that older clients admitted to the CRDT therefore could never be
 * tombstoned: the entry lived in the room forever, and only a console
 * workaround could remove it. A delete is now recorded when the copy already
 * has a CRDT entry and its path is not excluded.
 */
import { isLegacyConflictArtifactDeleteSyncable, isMarkdownSyncable } from "../../src/types";
import { readSource, suite } from "../harness.ts";

const s = suite("legacy-conflict-artifact-delete");

const CONFIG_DIR = ".obsidian";
const ARTIFACT = "Notes/Plan (YAOS conflict from phone 2026-04-01T10-00-00Z).md";
const EXCLUDED_ARTIFACT = "Private/Plan (YAOS conflict - disk from laptop 2026-05-02T08-30-00Z).md";
const ORDINARY = "Notes/Plan.md";

s.section("Test 1: legacy conflict copy with a CRDT entry is delete-syncable");
{
	s.check(
		!isMarkdownSyncable(ARTIFACT, [], CONFIG_DIR),
		"conflict copy is still not syncable for uploads",
	);
	s.check(
		isLegacyConflictArtifactDeleteSyncable(ARTIFACT, [], CONFIG_DIR, true),
		"delete of a conflict copy already in the CRDT is recorded",
	);
}

s.section("Test 2: local-only conflict copy stays local on delete");
{
	s.check(
		!isLegacyConflictArtifactDeleteSyncable(ARTIFACT, [], CONFIG_DIR, false),
		"delete of a conflict copy with no CRDT entry is not recorded",
	);
}

s.section("Test 3: exclusions still win");
{
	s.check(
		!isLegacyConflictArtifactDeleteSyncable(EXCLUDED_ARTIFACT, ["Private/"], CONFIG_DIR, true),
		"conflict copy in an excluded folder is not recorded",
	);
	s.check(
		!isLegacyConflictArtifactDeleteSyncable(`${CONFIG_DIR}/${ARTIFACT}`, [], CONFIG_DIR, true),
		"conflict copy in the config dir is not recorded",
	);
}

s.section("Test 4: ordinary notes are not affected by the legacy rule");
{
	s.check(
		!isLegacyConflictArtifactDeleteSyncable(ORDINARY, [], CONFIG_DIR, true),
		"ordinary note is not classified as a legacy conflict copy",
	);
	s.check(isMarkdownSyncable(ORDINARY, [], CONFIG_DIR), "ordinary note remains syncable");
}

s.section("Test 5: the vault delete handler uses the delete-specific predicate");
{
	const main = readSource("src/main.ts");
	const start = main.indexOf('this.app.vault.on("delete"');
	const end = main.indexOf('this.app.vault.on("create"', start);
	const handler = start >= 0 && end > start ? main.slice(start, end) : null;
	s.check(handler !== null, "delete handler found");
	s.check(
		handler?.includes("if (this.isMarkdownDeleteSyncable(file.path)) {") ?? false,
		"delete handler gates on isMarkdownDeleteSyncable",
	);
	s.check(
		!(handler?.includes("if (this.isMarkdownPathSyncable(file.path)) {") ?? true),
		"delete handler no longer gates on the upload predicate",
	);
	const predicate = main.slice(main.indexOf("private isMarkdownDeleteSyncable("));
	s.check(
		predicate.includes("isLegacyConflictArtifactDeleteSyncable(")
		&& predicate.includes("this.vaultSync?.getFileId(path)"),
		"predicate checks for an existing CRDT entry",
	);
}

await s.done();
