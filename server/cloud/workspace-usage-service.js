import { buildWorkspaceQuotaProjection } from "./workspace-quota.js";

export class WebWorkspaceUsageService {
  constructor({ draftRepository, mediaRepository, quota = {} } = {}) {
    if (!draftRepository) throw new Error("WebWorkspaceUsageService 缺少 draftRepository");
    if (!mediaRepository) throw new Error("WebWorkspaceUsageService 缺少 mediaRepository");
    this.draftRepository = draftRepository;
    this.mediaRepository = mediaRepository;
    this.quota = quota;
  }

  async get({ context, storeId } = {}) {
    const [draftUsage, mediaUsage] = await Promise.all([
      this.draftRepository.usage({ tenantId: context.tenantId, storeId }),
      this.mediaRepository.usage({ tenantId: context.tenantId, storeId }),
    ]);
    return {
      ...buildWorkspaceQuotaProjection({
        draftUsage,
        mediaUsage,
        quota: this.quota,
      }),
      generatedAt: new Date().toISOString(),
    };
  }
}
