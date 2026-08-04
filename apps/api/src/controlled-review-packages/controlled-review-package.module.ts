import { Module } from "@nestjs/common";
import { ControlledReviewPackageController } from "./controlled-review-package.controller.js";
import { ControlledReviewPackageFreshnessService } from "./controlled-review-package-freshness.service.js";
import { ControlledReviewPackageService } from "./controlled-review-package.service.js";

@Module({
  controllers: [ControlledReviewPackageController],
  providers: [
    ControlledReviewPackageFreshnessService,
    ControlledReviewPackageService,
  ],
})
export class ControlledReviewPackageModule {}
