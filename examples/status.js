// Shared display text, not part of the hardware protocol.
export function showBinding(borrow, input) {
  borrow.onChange = () => {
    let status = borrow.status;
    if (status === "Connected") {
      status = input.lender ? `Borrowed from ${input.lender.name}` : "Waiting for someone to lend";
    }
    document.querySelector("#status").textContent = status;
  };
}
