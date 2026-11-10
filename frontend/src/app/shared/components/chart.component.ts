import { Component, ElementRef, effect, inject, input, viewChild, type OnDestroy } from '@angular/core';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type ChartData,
  type ChartOptions,
  type ChartType,
} from 'chart.js';
import { ThemeService } from '../../core/services/theme.service';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, DoughnutController, ArcElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

/** Theme-aware Chart.js wrapper. Re-renders when data, options or the theme change. */
@Component({
  selector: 'app-chart',
  template: `<div class="wrap" [style.height.px]="height()"><canvas #canvas role="img" [attr.aria-label]="label()"></canvas></div>`,
  styles: `.wrap { position: relative; width: 100%; }`,
})
export class ChartComponent implements OnDestroy {
  private readonly theme = inject(ThemeService);
  readonly type = input.required<ChartType>();
  readonly data = input.required<ChartData>();
  readonly options = input<ChartOptions>({});
  readonly height = input(240);
  readonly label = input('Chart');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart;

  constructor() {
    effect(() => {
      const dark = this.theme.isDark();
      const text = dark ? '#9aa3b5' : '#718096';
      const grid = dark ? 'rgba(255,255,255,0.06)' : 'rgba(23,25,35,0.06)';
      const config: ChartConfiguration = {
        type: this.type(),
        data: this.data(),
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 500 },
          plugins: {
            legend: { labels: { color: text, usePointStyle: true, boxWidth: 8, font: { family: 'Inter', size: 12 } } },
            tooltip: { backgroundColor: dark ? '#262a37' : '#171923', padding: 10, cornerRadius: 10, titleFont: { family: 'Inter' }, bodyFont: { family: 'Inter' } },
          },
          scales:
            this.type() === 'doughnut'
              ? {}
              : {
                  x: { grid: { display: false }, ticks: { color: text, font: { family: 'Inter', size: 11 } }, border: { display: false } },
                  y: { grid: { color: grid }, ticks: { color: text, font: { family: 'Inter', size: 11 } }, border: { display: false }, beginAtZero: true },
                },
          ...this.options(),
        } as ChartOptions,
      };
      this.chart?.destroy();
      this.chart = new Chart(this.canvas().nativeElement, config);
    });
  }

  ngOnDestroy() {
    this.chart?.destroy();
  }
}
