/**********************************************************************
 * Copyright (C) 2023 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { type Locator, type Page, test } from '@playwright/test';
import { expect as playExpect } from '@playwright/test';

import { findTableRow, forEachTableRow, getTableRowCount } from '/@/utility/table';
import { waitUntil } from '/@/utility/wait';

import { BasePage } from './base-page';

/**
 * Abstract representation of a visual page objects of the main content pages of Podman Desktop app: Images,
 * Containers, Volumes and Pods.
 * Is not intended to be directly used, but rather by particular page's implementation.
 */
export abstract class MainPage extends BasePage {
  readonly title: string;
  readonly mainPage: Locator;
  readonly header: Locator;
  readonly search: Locator;
  readonly content: Locator;
  readonly additionalActions: Locator;
  readonly bottomAdditionalActions: Locator;
  readonly heading: Locator;
  readonly noContainerEngineHeading: Locator;
  readonly noImagesHeading: Locator;
  readonly rowTable: Locator;
  readonly searchInput: Locator;
  readonly environmentDropdown: Locator;

  constructor(page: Page, title: string) {
    super(page);
    this.title = title;
    this.mainPage = page.getByRole('region', { name: this.title });
    this.header = this.mainPage.getByRole('region', { name: 'header' });
    this.search = this.mainPage.getByRole('region', { name: 'search' });
    this.content = this.mainPage.getByRole('region', { name: 'content' });
    this.additionalActions = this.header.getByRole('group', {
      name: 'additionalActions',
    });
    this.bottomAdditionalActions = this.search.getByRole('group', {
      name: 'bottomAdditionalActions',
    });
    this.heading = this.header.getByRole('heading', { name: this.title });
    this.noContainerEngineHeading = this.content.getByRole('heading', {
      name: 'No Container Engine',
      exact: true,
    });
    this.noImagesHeading = this.content.getByRole('heading', {
      name: `No ${this.title}`,
      exact: true,
    });
    this.rowTable = this.content.getByRole('table');
    this.searchInput = this.search.getByLabel(`search ${this.title}`);
    this.environmentDropdown = this.bottomAdditionalActions.getByLabel('Environment');
  }

  /**
   * Check the presence of items in main page's content.
   * @returns true, if there are any items present in the content's table, false otherwise
   */
  async pageIsEmpty(): Promise<boolean> {
    return test.step('Check if the page is empty', async () => {
      if (await this.noContainerEngine()) return true;
      return (await this.noImagesHeading.count()) > 0;
    });
  }

  async noContainerEngine(): Promise<boolean> {
    return test.step('Check if there is no container engine', async () => {
      return (await this.noContainerEngineHeading.count()) > 0;
    });
  }

  async rowsAreVisible(): Promise<boolean> {
    return await this.page.getByRole('row').first().isVisible();
  }

  /**
   * Get the rows currently rendered in the table (including the header row).
   * Large tables are virtualized and only render the visible rows: use forEachTableRow to visit all the rows.
   */
  async getAllTableRows(): Promise<Locator[]> {
    return await this.rowTable.getByRole('row').all();
  }

  /**
   * Call `visit` for each row of the table (except the header row), scrolling the table if needed.
   * The iteration stops when `visit` returns true.
   */
  async forEachTableRow(visit: (row: Locator) => Promise<boolean | void>): Promise<void> {
    await forEachTableRow(this.rowTable, visit);
  }

  async getRowsFromTableByStatus(status: string): Promise<Locator[]> {
    return test.step(`Get rows from ${this.title} page table by status: ${status}`, async () => {
      await waitUntil(async () => await this.rowsAreVisible(), {
        sendError: false,
      });

      const filteredRows: Locator[] = [];
      await this.forEachTableRow(async row => {
        const statusCount = await row.getByRole('cell').nth(2).getByTitle(status, { exact: true }).count();
        const label = await row.getAttribute('aria-label');
        // the locators returned by getAllTableRows depend on the rendered rows, use a locator by name instead
        if (statusCount > 0 && label) filteredRows.push(this.rowTable.getByRole('row', { name: label, exact: true }));
      });
      return filteredRows;
    });
  }

  async countRowsFromTable(): Promise<number> {
    return test.step(`Count rows from ${this.title} page table`, async () => {
      await waitUntil(async () => await this.rowsAreVisible(), {
        sendError: false,
      });
      // large tables do not render all the rows, the total number of rows is given by the table
      return getTableRowCount(this.content.getByRole('table'));
    });
  }

  async getRowByName(name: string, exact = true): Promise<Locator | undefined> {
    return test.step(`Get row from ${this.title} page table by name: ${name}`, async () => {
      const locator = this.page
        .getByRole('row')
        .and(this.page.getByLabel(name, { exact: exact }))
        .first();

      // scroll the table to find the row if it is not rendered (large tables only render the visible rows)
      return findTableRow(this.rowTable, locator);
    });
  }

  async waitForRowToExists(name: string, timeout = 5_000): Promise<boolean> {
    return test.step(`Wait for row with name: ${name} to exist`, async () => {
      await waitUntil(async () => (await this.getRowByName(name)) !== undefined, { timeout: timeout });
      return true;
    });
  }

  async waitForRowToBeDelete(name: string, timeout = 5_000): Promise<boolean> {
    return test.step(`Wait for row with name: ${name} to be deleted`, async () => {
      await waitUntil(async () => (await this.getRowByName(name)) === undefined, { timeout: timeout });
      return true;
    });
  }

  async uncheckAllRows(): Promise<void> {
    return test.step(`Uncheck all rows on ${this.title} page`, async () => {
      try {
        const toggle = await this.getToggleLocator();

        if ((await toggle.innerHTML()).includes('pd-input-checkbox-indeterminate')) {
          await toggle.click();
        }

        if ((await toggle.innerHTML()).includes('pd-input-checkbox-checked')) {
          await toggle.click();
        }

        await playExpect
          .poll(async () => await toggle.innerHTML(), { timeout: 15_000 })
          .toContain('pd-input-checkbox-unchecked');
      } catch (err) {
        console.log(`Exception caught on ${this.title} page when checking cells for unchecking with message: ${err}`);
        throw err;
      }
    });
  }

  async checkAllRows(): Promise<void> {
    return test.step(`Checks all rows on ${this.title} page`, async () => {
      try {
        const toggle = await this.getToggleLocator();

        if ((await toggle.innerHTML()).includes('pd-input-checkbox-unchecked')) {
          await toggle.click();
        }

        await playExpect
          .poll(async () => toggle.innerHTML(), { timeout: 15_000 })
          .toContain('pd-input-checkbox-checked');
      } catch (err) {
        console.log(`Exception caught on containers page when checking cells with message: ${err}`);
        throw err;
      }
    });
  }

  private async getToggleLocator(): Promise<Locator> {
    await playExpect(this.rowTable).toBeVisible();
    const controlRow = this.rowTable.getByRole('row').first();
    await playExpect(controlRow).toBeAttached();
    const checkboxColumnHeader = controlRow.getByRole('columnheader').nth(1);
    await playExpect(checkboxColumnHeader).toBeAttached();
    const toggle = checkboxColumnHeader.getByTitle('Toggle all');
    await playExpect(toggle).toBeAttached();

    return toggle;
  }

  async filterByName(name: string): Promise<void> {
    return test.step(`Filter ${this.title} by name: ${name}`, async () => {
      await playExpect(this.searchInput).toBeVisible();
      await this.searchInput.fill(name);
      await playExpect(this.searchInput).toHaveValue(name);
    });
  }

  async clearFilterByName(): Promise<void> {
    return test.step(`Clear name filter on ${this.title} page`, async () => {
      await playExpect(this.searchInput).toBeVisible();
      await this.searchInput.clear();
      await playExpect(this.searchInput).toHaveValue('');
    });
  }

  async filterByEnvironment(environment: string): Promise<void> {
    return test.step(`Filter ${this.title} by environment: ${environment}`, async () => {
      await playExpect(this.environmentDropdown).toBeVisible();
      await this.environmentDropdown.click();
      const option = this.environmentDropdown.getByRole('button').filter({ hasText: environment });
      await playExpect(option).toBeVisible();
      await option.click();
    });
  }

  async clearFilterByEnvironment(): Promise<void> {
    return test.step(`Clear environment filter on ${this.title} page`, async () => {
      await this.filterByEnvironment('All');
    });
  }

  async isEnvironmentFilterVisible(): Promise<boolean> {
    return test.step(`Check if environment filter is visible on ${this.title} page`, async () => {
      return await this.environmentDropdown.isVisible();
    });
  }
}
