import { z } from 'zod';

// Validate comment content schema
const commentSchema = z.object({
  content: z.string().min(1, 'Comment cannot be empty').max(2000, 'Comment is too long'),
});

// Validate share payload schema
const shareSchema = z.object({
  sharedToUserId: z.string().min(1, 'Recipient user is required'),
  note: z.string().max(1000).optional(),
});

describe('Social Media Engagement Tracking Validation', () => {
  describe('Comment Validation', () => {
    test('valid comment passes validation', () => {
      const res = commentSchema.safeParse({ content: 'Great post! Love the video quality.' });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.content).toBe('Great post! Love the video quality.');
      }
    });

    test('empty comment is rejected', () => {
      const res = commentSchema.safeParse({ content: '' });
      expect(res.success).toBe(false);
    });

    test('overly long comment (> 2000 chars) is rejected', () => {
      const res = commentSchema.safeParse({ content: 'a'.repeat(2001) });
      expect(res.success).toBe(false);
    });
  });

  describe('Share Validation', () => {
    test('valid share payload passes validation', () => {
      const res = shareSchema.safeParse({
        sharedToUserId: 'user-uuid-1234',
        note: 'Check out this awesome campaign update!',
      });
      expect(res.success).toBe(true);
    });

    test('share without recipient is rejected', () => {
      const res = shareSchema.safeParse({
        sharedToUserId: '',
        note: 'Note without recipient',
      });
      expect(res.success).toBe(false);
    });

    test('share with optional note omitted is accepted', () => {
      const res = shareSchema.safeParse({
        sharedToUserId: 'user-uuid-5678',
      });
      expect(res.success).toBe(true);
    });
  });

  describe('Engagement Aggregation Logic', () => {
    test('calculates correct engagement counts and user liked state', () => {
      const post = {
        id: 'post-1',
        _count: { likes: 12, comments: 4, shares: 3 },
      };
      const myLikedPostIds = new Set(['post-1', 'post-3']);

      const likesCount = post._count.likes;
      const commentsCount = post._count.comments;
      const sharesCount = post._count.shares;
      const hasLiked = myLikedPostIds.has(post.id);

      expect(likesCount).toBe(12);
      expect(commentsCount).toBe(4);
      expect(sharesCount).toBe(3);
      expect(hasLiked).toBe(true);
    });

    test('like toggle logic correctly flips state', () => {
      let isLiked = false;
      let count = 5;

      // User likes
      isLiked = !isLiked;
      count += isLiked ? 1 : -1;
      expect(isLiked).toBe(true);
      expect(count).toBe(6);

      // User unlikes
      isLiked = !isLiked;
      count += isLiked ? 1 : -1;
      expect(isLiked).toBe(false);
      expect(count).toBe(5);
    });
  });
});

