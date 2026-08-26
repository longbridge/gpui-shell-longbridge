# Pointer Indicators and Resizable Market Panes

## Goal

Demonstrate native GPUI pointer geometry and resizable pane behavior through gpui-shell while improving the Longbridge read-only market UI.

## Public shell API

Interactive elements may register `on_mouse_move(handler)` and `on_hover(handler)`. A mouse-move handler receives `{ x, y, local_x, local_y, width, height }`: `x` and `y` are window coordinates in pixels, `local_x` and `local_y` are clamped ratios from 0 to 1, and width/height are the resolved element bounds in pixels. Hover receives a boolean. Both callbacks run in the ordinary event scope and applications call `cx.notify()` after changing visible state.

Resizable layout is exposed through `h_resizable(id)`, `v_resizable(id)`, and `resizable_panel()`. Panels accept `size(number)`, `size_range(min, max)`, and `visible(boolean)`; groups accept `on_resize((sizes, cx) => ...)`. Sizes are percentages, retained by gpui-base under the stable group id, and do not require a JavaScript render during dragging.

## Application behavior

At desktop widths Watchlist and Stock Details are children of one horizontal resizable group, defaulting to 60/40 and clamped to 35–75% for the list. At narrow widths the existing wrapped vertical composition remains, because a horizontal drag handle is not useful when the panes are stacked.

The five-day chart stores only the last normalized pointer coordinate. Rendering chooses the nearest laid-out point, then draws the vertical guide and marker with `Path`/`Background`. The header shows that point's market-local date/time and price. Leaving the plot clears the indicator. Quote updates do not flash or rewrite unrelated detail text.

The allocation donut uses `tokens.primary` at five descending opacity levels. The legend uses the same color/opacity mapping. No raw palette literals remain, and identity continues to be expressed by labels and percentages rather than color alone.

## Verification

Shell tests cover callback dispatch, local-coordinate normalization, hover exit, resizable constructors, panel constraints, typings, and materialization. Application vector tests cover nearest-point selection, indicator paths, resizable descriptions, responsive fallback, and token-only allocation colors. Manual review covers drag smoothness and light/dark contrast.
