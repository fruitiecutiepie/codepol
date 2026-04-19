/**
 * @packageDocumentation
 * Constants for the Phase 9.4 member-shape extractor and the cross-file
 * structural-shape resolution pass.
 *
 * Kept in their own module so the extractor and the cross-file pass
 * pull from one place — drift between the two would silently mis-emit
 * structural-shape edges.
 */

/**
 * Maximum public members captured per owner ({@link MemberShapeRelation}).
 *
 * Picked to comfortably cover real-world classes and interfaces while
 * bounding the per-file cost of the extractor and the cross-file shape
 * comparison. Owners with more public members produce a relation with
 * `memberCountTruncated: true`; the cross-file pass refuses to compare
 * against a truncated owner so structural-shape edges are never emitted
 * with incomplete information.
 */
export const MEMBER_SHAPE_CAP_PER_TYPE = 64;
