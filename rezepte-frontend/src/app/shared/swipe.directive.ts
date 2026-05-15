import { Directive, ElementRef, inject, output, OnInit, OnDestroy } from '@angular/core';

@Directive({
  selector: '[appSwipe]',
  standalone: true,
})
export class SwipeDirective implements OnInit, OnDestroy {
  readonly swipeLeft = output<void>();
  readonly swipeRight = output<void>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private startX = 0;
  private startY = 0;
  private startedAt = 0;
  private active = false;

  private readonly onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length !== 1) return;
    // Wenn Touch in einem horizontal scrollbaren Element startet → kein Tab-Swipe
    let node: HTMLElement | null = e.target as HTMLElement;
    while (node && node !== this.el.nativeElement) {
      const style = getComputedStyle(node);
      const overflowX = style.overflowX;
      if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth) {
        this.active = false;
        return;
      }
      node = node.parentElement;
    }
    this.startX = e.touches[0].clientX;
    this.startY = e.touches[0].clientY;
    this.startedAt = Date.now();
    this.active = true;
  };

  private readonly onTouchEnd = (e: TouchEvent): void => {
    if (!this.active) return;
    this.active = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - this.startX;
    const dy = t.clientY - this.startY;
    const dt = Date.now() - this.startedAt;

    // Min 60px horizontal, max 50px vertical Drift, schneller als 800ms
    if (Math.abs(dx) < 60 || Math.abs(dy) > 50 || dt > 800) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;

    if (dx < 0) this.swipeLeft.emit();
    else this.swipeRight.emit();
  };

  ngOnInit(): void {
    const node = this.el.nativeElement;
    node.addEventListener('touchstart', this.onTouchStart, { passive: true });
    node.addEventListener('touchend', this.onTouchEnd, { passive: true });
  }

  ngOnDestroy(): void {
    const node = this.el.nativeElement;
    node.removeEventListener('touchstart', this.onTouchStart);
    node.removeEventListener('touchend', this.onTouchEnd);
  }
}
