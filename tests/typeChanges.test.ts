import {
  applyChangeset,
  atomizeChangeset,
  diff,
  Operation,
  revertChangeset,
  unatomizeChangeset
} from '../src/jsonDiff';

const objectValues: Record<string, unknown>[] = [{}, { enabled: true }];
const replacementValues = [false, true, 0, 10, '', 'none', [], [1], new Date('2026-10-10T00:00:00Z')];
const transitions = objectValues.flatMap(oldValue => replacementValues.map(value => ({ oldValue, value })));

// These containers have identical enumerable keys and values, but different types.
transitions.push({ oldValue: { 0: 1 }, value: [1] });

describe('object type changes', () => {
  it.each(transitions)('updates the complete root value from $oldValue to $value', ({ oldValue, value }) => {
    expect(diff(oldValue, value, { treatTypeChangeAsReplace: false })).toEqual([
      { type: Operation.UPDATE, key: '$root', oldValue, value }
    ]);
  });

  it.each(transitions)('round-trips a nested field from $oldValue to $value', ({ oldValue, value }) => {
    const before = { settings: { config: oldValue } };
    const after = { settings: { config: value } };
    const changes = diff(before, after, { treatTypeChangeAsReplace: false });

    expect(changes).toEqual([
      {
        type: Operation.UPDATE,
        key: 'settings',
        changes: [{ type: Operation.UPDATE, key: 'config', oldValue, value }]
      }
    ]);

    expect(applyChangeset(structuredClone(before), changes)).toEqual(after);
    expect(revertChangeset(structuredClone(after), changes)).toEqual(before);

    const atomicChanges = atomizeChangeset(changes);

    expect(atomicChanges).toEqual([
      expect.objectContaining({ type: Operation.UPDATE, path: '$.settings.config', oldValue, value })
    ]);
    expect(applyChangeset(structuredClone(before), unatomizeChangeset(atomicChanges))).toEqual(after);
  });

  it.each(transitions)('round-trips an array element from $oldValue to $value', ({ oldValue, value }) => {
    const before = { configs: [oldValue] };
    const after = { configs: [value] };
    const changes = diff(before, after, { treatTypeChangeAsReplace: false });

    expect(changes).toEqual([
      {
        type: Operation.UPDATE,
        key: 'configs',
        embeddedKey: '$index',
        changes: [{ type: Operation.UPDATE, key: '0', oldValue, value }]
      }
    ]);
    expect(applyChangeset(structuredClone(before), changes)).toEqual(after);
    expect(revertChangeset(structuredClone(after), changes)).toEqual(before);
  });

  it.each(transitions)('preserves replacement mode from $oldValue to $value', ({ oldValue, value }) => {
    const before = { config: oldValue };
    const after = { config: value };
    const expected = [
      { type: Operation.REMOVE, key: 'config', value: oldValue },
      { type: Operation.ADD, key: 'config', value }
    ];

    expect(diff(before, after)).toEqual(expected);
    expect(diff(before, after, { treatTypeChangeAsReplace: true })).toEqual(expected);
  });

  it('respects skipped fields inside arrays with identity keys', () => {
    const before = { items: [{ id: 'a', config: { enabled: true }, ignored: {} }] };
    const after = { items: [{ id: 'a', config: false, ignored: false }] };
    const changes = diff(before, after, {
      treatTypeChangeAsReplace: false,
      embeddedObjKeys: { items: 'id' },
      keysToSkip: ['items.ignored']
    });

    expect(atomizeChangeset(changes)).toEqual([
      {
        type: Operation.UPDATE,
        key: 'config',
        path: "$.items[?(@.id=='a')].config",
        valueType: 'Boolean',
        oldValue: { enabled: true },
        value: false
      }
    ]);
    expect(applyChangeset(structuredClone(before), changes)).toEqual({
      items: [{ id: 'a', config: false, ignored: {} }]
    });
    expect(revertChangeset(structuredClone(after), changes)).toEqual({
      items: [{ id: 'a', config: { enabled: true }, ignored: false }]
    });
  });
});
