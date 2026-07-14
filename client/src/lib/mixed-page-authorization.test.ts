import { describe, expect, it } from 'vitest';
import { apiEndpoints } from '@/api/generated';
import { MIXED_PAGE_AUTHORIZATION } from './mixed-page-authorization';
import { ROUTE_AUTHORIZATION } from './permissions';

const pageSources = import.meta.glob('../pages/*.tsx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

describe('mixed-page API authorization inventory', () => {
  it('matches every declared endpoint to its generated server tenantScope', () => {
    for (const [path, inventory] of Object.entries(MIXED_PAGE_AUTHORIZATION)) {
      const scopes = new Set<string>();
      const endpointIds = new Set<string>();

      for (const dependency of inventory.dependencies) {
        scopes.add(dependency.scope);
        expect(dependency.phases.length, `${path} ${dependency.section}`).toBeGreaterThan(
          0,
        );

        for (const endpointId of dependency.endpoints) {
          expect(endpointIds.has(endpointId), `${path} duplicates ${endpointId}`).toBe(
            false,
          );
          endpointIds.add(endpointId);
          expect(
            apiEndpoints[endpointId].tenantScope,
            `${path} ${endpointId}`,
          ).toBe(dependency.scope);
        }
      }

      expect(scopes.size, `${path} must remain a mixed-scope page`).toBeGreaterThan(1);
    }
  });

  it('keeps route contracts aligned with composite and partial page decisions', () => {
    expect(
      Object.entries(ROUTE_AUTHORIZATION)
        .filter(([, contract]) => contract.strategy !== 'single')
        .map(([path]) => path)
        .sort(),
    ).toEqual(Object.keys(MIXED_PAGE_AUTHORIZATION).sort());

    for (const [path, inventory] of Object.entries(MIXED_PAGE_AUTHORIZATION)) {
      const route = path as keyof typeof ROUTE_AUTHORIZATION;
      const contract = ROUTE_AUTHORIZATION[route];
      expect(contract.strategy, path).toBe(inventory.strategy);

      if (inventory.strategy !== 'composite') continue;
      const mountedScopes = new Set(
        contract.requirements.map((requirement) => requirement.scope),
      );
      for (const dependency of inventory.dependencies) {
        expect(mountedScopes.has(dependency.scope), `${path} ${dependency.scope}`).toBe(
          true,
        );
        expect(dependency.gate, `${path} ${dependency.section}`).toBe('route');
      }
    }
  });

  it('requires an explicit named guard for every partial-page cross-scope group', () => {
    for (const [path, inventory] of Object.entries(MIXED_PAGE_AUTHORIZATION)) {
      if (inventory.strategy !== 'partial') continue;
      const source = pageSources[`../pages/${inventory.sourceFile}`];
      expect(source, `${path} source ${inventory.sourceFile}`).toBeTypeOf('string');

      for (const dependency of inventory.dependencies) {
        if (dependency.gate === 'route') continue;
        for (const guard of dependency.gate.split('/')) {
          const guardName = guard.trim();
          expect(guardName, `${path} must name its cross-scope guard`).not.toBe('');
          expect(
            source.includes(guardName),
            `${path} source must contain guard ${guardName}`,
          ).toBe(
            true,
          );
        }
      }
    }
  });

  it('locks the four required inseparable pages to composite mount authorization', () => {
    for (const path of [
      '/admin/motivation',
      '/admin/catalog',
      '/admin/shift-reports',
      '/admin/finances',
    ] as const) {
      expect(MIXED_PAGE_AUTHORIZATION[path].strategy).toBe('composite');
      expect(
        ROUTE_AUTHORIZATION[path].requirements.map(({ scope }) => scope).sort(),
      ).toEqual(['club', 'organization']);
    }
  });
});
