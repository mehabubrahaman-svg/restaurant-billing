import { test as setup } from '@playwright/test';
import { apiAs, OWNER, STAFF, STAFF_PASSWORD } from '../support/restaurant';

/**
 * Stocks the restaurant the wizard just created, through the API (the admin
 * screens have their own component tests): staff, kitchen stations, a small
 * menu with sizes, add-ons and a bar item, tables, a service charge and Swiggy.
 */
setup('stock the restaurant', async ({ request }) => {
  const api = await apiAs(request, OWNER.username, OWNER.password);
  const roles = (await api<{ data: { id: string; code: string }[] }>('GET', '/roles')).data;
  for (const s of Object.values(STAFF)) {
    await api('POST', '/users', {
      username: s.username,
      fullName: s.fullName,
      password: STAFF_PASSWORD,
      pin: s.pin,
      roleIds: [roles.find((r) => r.code === s.role)!.id],
    });
  }
  const groups = (
    await api<{ data: { id: string; name: string; taxType: string }[] }>('GET', '/tax-groups')
  ).data;
  const gst5 = groups.find((g) => g.name === 'GST 5%')!.id;
  const vat = groups.find((g) => g.taxType === 'VAT')!.id;
  const station = async (name: string) =>
    (await api<{ id: string }>('POST', '/kitchen-stations', { name })).id;
  const main = await station('Main Kitchen');
  const tandoor = await station('Tandoor');
  const bar = await station('Bar');
  const category = async (name: string) =>
    (await api<{ id: string }>('POST', '/categories', { name })).id;
  const biryani = await category('Biryani');
  const breads = await category('Breads');
  const drinks = await category('Bar');
  const sides = await api<{ id: string }>('POST', '/addon-groups', {
    name: 'Sides',
    maxSelect: 2,
    addons: [
      { name: 'Raita', price: 4000 },
      { name: 'Salan', price: 3000 },
    ],
  });
  await api('POST', '/menu-items', {
    sku: 'BIR-CHK',
    name: 'Chicken Biryani',
    categoryId: biryani,
    foodType: 'NON_VEG',
    basePrice: 32000,
    taxGroupId: gst5,
    kitchenStationId: main,
    prepTimeSec: 1200,
    variants: [
      { name: 'Half', price: 19000 },
      { name: 'Full', price: 32000 },
    ],
    addonGroupIds: [sides.id],
  });
  await api('POST', '/menu-items', {
    sku: 'BRD-BTR',
    name: 'Butter Naan',
    categoryId: breads,
    foodType: 'VEG',
    basePrice: 6000,
    taxGroupId: gst5,
    kitchenStationId: tandoor,
    prepTimeSec: 300,
  });
  await api('POST', '/menu-items', {
    sku: 'BAR-BEER',
    name: 'Beer 650 ml',
    categoryId: drinks,
    foodType: 'NA',
    basePrice: 32000,
    taxGroupId: vat,
    kitchenStationId: bar,
    prepTimeSec: 120,
  });
  const area = await api<{ id: string }>('POST', '/floor-areas', { name: 'Ground floor' });
  for (const [label, posX] of [
    ['T1', 2],
    ['T2', 8],
    ['T3', 14],
  ] as const) {
    await api('POST', '/tables', {
      floorAreaId: area.id,
      label,
      posX,
      posY: 2,
      shape: 'SQUARE',
      seats: 4,
    });
  }
  await api('POST', '/sales-channels', {
    code: 'swiggy',
    name: 'Swiggy',
    commissionBp: 2200,
    priceMarkupBp: 1000,
  });
});
