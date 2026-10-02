/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
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

import { type NativeImage, nativeImage } from 'electron';

const ICON_SIZE = 32;
let icon: NativeImage | undefined;

// the image displayed under the cursor while files are dragged out of the application (a rounded square)
export function getDragIcon(): NativeImage {
  if (!icon) {
    const buffer = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4);
    const radius = 6;
    for (let y = 0; y < ICON_SIZE; y++) {
      for (let x = 0; x < ICON_SIZE; x++) {
        const dx = Math.max(radius - x, x - (ICON_SIZE - 1 - radius), 0);
        const dy = Math.max(radius - y, y - (ICON_SIZE - 1 - radius), 0);
        if (dx * dx + dy * dy > radius * radius) {
          continue;
        }
        // BGRA: purple of Podman Desktop
        buffer.set([0xd5, 0x5b, 0x8b, 0xff], (y * ICON_SIZE + x) * 4);
      }
    }
    icon = nativeImage.createFromBitmap(buffer, { width: ICON_SIZE, height: ICON_SIZE });
  }
  return icon;
}
