import { View } from "gpui";
import { Avatar, AvatarFallback, AvatarImage, h_flex } from "gpui-base";

// `Avatar` is the one component whose children are slots rather than elements:
// `image` takes an `AvatarImage` and `fallback` an `AvatarFallback`, and the
// component -- not the description -- decides which of the two is drawn. So
// both are always described, and the probe is two avatars rather than one:
// the first has an image to prefer, the second has only its fallback.
//
// Square, not `rounded_full`: this application's geometry has no pills in it.
const AVATAR_SIZE = 24;

/** @param {string} initials @param {string | null} image */
function avatar(initials, image) {
  const built = Avatar.new()
    .w(AVATAR_SIZE)
    .h(AVATAR_SIZE)
    .overflow_hidden()
    .fallback(
      AvatarFallback.new().size_full().flex().items_center().justify_center().child(initials),
    );
  return image ? built.image(AvatarImage.new(image).size_full()) : built;
}

export default class AvatarSlotsProbe extends View {
  render() {
    return h_flex()
      .gap(8)
      .child(avatar("LB", "assets/logo-light.svg"))
      .child(avatar("US", null));
  }
}
