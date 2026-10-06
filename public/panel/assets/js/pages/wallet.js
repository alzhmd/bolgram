import { emptyState } from '../core.js';

// Placeholder until this page is built.
export async function render(page) {
  page.innerHTML = `<section class="card">${emptyState('bolt', 'در حال ساخت', 'این بخش به‌زودی فعال می‌شود.', '<a class="btn btn-primary" href="#/dashboard">داشبورد</a>')}</section>`;
}
