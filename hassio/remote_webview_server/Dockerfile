# SPDX-License-Identifier: Apache-2.0
#
# Copyright (c) 2026 minhquanghp86
# Licensed under the Apache License, Version 2.0 (see LICENSE).
ARG BUILD_FROM
FROM ${BUILD_FROM}

# (23/09/2026) SUA LOI: run.sh ton tai trong repo tu truoc nhung CHUA BAO
# GIO duoc goi — container chay thang CMD cua image goc (node dist/index.js),
# bo qua hoan toan /data/options.json cua Supervisor. Hau qua: MOI tuy chon
# tren giao dien addon (tile_size, jpeg_quality, user_data_dir, ...) tru
# browser_locale khong lam gi ca, du hien ra nhu dang duoc ap dung.
COPY run.sh /run.sh
RUN chmod +x /run.sh
CMD ["/run.sh"]
